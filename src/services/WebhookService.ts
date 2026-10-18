import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { logger } from "../lib/logger";

/**
 * VERIFIED (docs.bosta.co/docs/how-to/get-delivery-status-via-webhook):
 * Bosta's webhook payload does NOT include a dedicated unique event id
 * field. The documented fields are: _id, trackingNumber, state (Number),
 * type (String), cod, timeStamp, isConfirmedDelivery, deliveryPromiseDate,
 * exceptionReason, exceptionCode, businessReference, numberOfAttempts.
 *
 * Consequence: our own idempotency key for a webhook delivery must be
 * SYNTHESIZED, not taken from a Bosta-provided event id (there isn't one).
 * We use `${trackingNumber}:${state}:${timeStamp}` -- a genuine retry of
 * the exact same state-change notification will repeat all three values;
 * two different real state changes will differ in at least `state` or
 * `timeStamp`.
 */
function synthesizeIdempotencyKey(payload: {
  trackingNumber: string;
  state: number;
  timeStamp: number;
}): string {
  return `${payload.trackingNumber}:${payload.state}:${payload.timeStamp}`;
}

/**
 * VERIFIED numeric Bosta state codes relevant to Exchange shipments
 * (docs.bosta.co "Bosta States" table). Several codes are shared across
 * order types with different meanings, so this map is only applied when
 * the webhook's `type` field is confirmed to be "EXCHANGE" -- see
 * `processBostaWebhook` below.
 */
export const BOSTA_EXCHANGE_STATE_CODES = {
  PICKUP_REQUESTED: 10,
  ROUTE_ASSIGNED: 20,
  PICKED_UP_FROM_BUSINESS: 21,
  PICKING_UP_FROM_CONSIGNEE: 22, // "out for exchange" for EXCHANGE type
  PICKED_UP_FROM_CONSIGNEE: 23,
  RECEIVED_AT_WAREHOUSE: 24,
  IN_TRANSIT_BETWEEN_HUBS: 30,
  RETURNED_TO_BUSINESS: 46,
  EXCEPTION: 47,
  TERMINATED: 48,
  CANCELED: 49,
  LOST: 100,
  DAMAGED: 101,
  INVESTIGATION: 102,
  AWAITING_YOUR_ACTION: 103,
  ARCHIVED: 104,
  ON_HOLD: 105,
} as const;

const EXCHANGE_STATUS_BY_STATE_CODE: Record<number, string> = {
  [BOSTA_EXCHANGE_STATE_CODES.PICKUP_REQUESTED]: "BOSTA_EXCHANGE_CREATED",
  [BOSTA_EXCHANGE_STATE_CODES.ROUTE_ASSIGNED]: "BOSTA_EXCHANGE_CREATED",
  [BOSTA_EXCHANGE_STATE_CODES.PICKED_UP_FROM_BUSINESS]: "REPLACEMENT_SHIPPED",
  [BOSTA_EXCHANGE_STATE_CODES.PICKING_UP_FROM_CONSIGNEE]: "RETURN_IN_PROGRESS",
  [BOSTA_EXCHANGE_STATE_CODES.PICKED_UP_FROM_CONSIGNEE]: "RETURN_IN_PROGRESS",
  [BOSTA_EXCHANGE_STATE_CODES.RECEIVED_AT_WAREHOUSE]: "RETURN_IN_PROGRESS",
  [BOSTA_EXCHANGE_STATE_CODES.IN_TRANSIT_BETWEEN_HUBS]: "RETURN_IN_PROGRESS",
  [BOSTA_EXCHANGE_STATE_CODES.RETURNED_TO_BUSINESS]: "RETURNED_TO_BUSINESS",
  [BOSTA_EXCHANGE_STATE_CODES.EXCEPTION]: "FAILED",
  [BOSTA_EXCHANGE_STATE_CODES.TERMINATED]: "FAILED",
  [BOSTA_EXCHANGE_STATE_CODES.CANCELED]: "FAILED",
  [BOSTA_EXCHANGE_STATE_CODES.LOST]: "FAILED",
  [BOSTA_EXCHANGE_STATE_CODES.DAMAGED]: "FAILED",
};

/**
 * Pure function (unit-testable without a DB) mapping a verified numeric
 * Bosta state code + type to FITTEZ's internal ExchangeStatus. Returns
 * `undefined` for a state we intentionally don't map to a status change
 * (e.g. INVESTIGATION/AWAITING_YOUR_ACTION/ARCHIVED/ON_HOLD -- these are
 * recorded on the BostaShipment.currentState field but don't drive our
 * own workflow status), and returns `null` if `type` isn't "EXCHANGE" at
 * all (per the verified docs, several codes mean something different for
 * SEND/CRP/RTO -- we must not apply the Exchange mapping to those).
 */
export function mapBostaStateToExchangeStatus(
  state: number,
  type: string | undefined
): string | undefined | null {
  if (type !== "EXCHANGE") return null;
  return EXCHANGE_STATUS_BY_STATE_CODE[state];
}

export class WebhookService {
  static async processBostaWebhook(payload: {
    trackingNumber: string;
    state: number;
    type: string;
    timeStamp: number;
    businessReference?: string;
    raw: unknown;
  }) {
    const idempotencyKey = synthesizeIdempotencyKey(payload);

    const alreadyProcessed = await prisma.bostaWebhookEvent.findUnique({
      where: { externalEventId: idempotencyKey },
    });
    if (alreadyProcessed?.processedAt) {
      logger.info({ idempotencyKey }, "bosta_webhook_duplicate_ignored");
      return { deduplicated: true };
    }

    const shipment = await prisma.bostaShipment.findUnique({
      where: { bostaTrackingNumber: payload.trackingNumber },
    });

    const event = await prisma.bostaWebhookEvent.upsert({
      where: { externalEventId: idempotencyKey },
      create: {
        externalEventId: idempotencyKey,
        bostaShipmentId: shipment?.id,
        eventType: payload.type,
        stateCode: String(payload.state),
        payload: payload.raw as any,
      },
      update: {}, // never overwrite an already-processed event's data
    });

    if (!shipment) {
      logger.warn(
        { trackingNumber: payload.trackingNumber },
        "bosta_webhook_no_matching_shipment"
      );
      await prisma.bostaWebhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
      return { deduplicated: false, matched: false };
    }

    // Only apply the Exchange status mapping when the webhook's own type
    // field confirms this is an EXCHANGE shipment (per verified docs,
    // several numeric codes mean something different for other types).
    const mappedStatus = mapBostaStateToExchangeStatus(payload.state, payload.type);

    if (mappedStatus === null) {
      logger.warn(
        { trackingNumber: payload.trackingNumber, type: payload.type },
        "bosta_webhook_non_exchange_type_on_exchange_shipment"
      );
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.bostaShipment.update({
        where: { id: shipment.id },
        data: { currentState: String(payload.state) },
      });

      const updateData: Record<string, unknown> = {};
      if (mappedStatus) {
        updateData.status = mappedStatus;
      }

      // Section 41 (CRITICAL, unchanged by this verification): state 46
      // ("Returned to business") ONLY updates status/returnStatus. No
      // Shopify inventory mutation happens here or anywhere in this
      // transaction, regardless of state code.
      if (payload.state === BOSTA_EXCHANGE_STATE_CODES.RETURNED_TO_BUSINESS) {
        updateData.returnStatus = "RETURNED_TO_BUSINESS";
      } else if (
        payload.state === BOSTA_EXCHANGE_STATE_CODES.PICKING_UP_FROM_CONSIGNEE ||
        payload.state === BOSTA_EXCHANGE_STATE_CODES.PICKED_UP_FROM_CONSIGNEE
      ) {
        updateData.returnStatus = "IN_PROGRESS";
      }

      if (Object.keys(updateData).length > 0) {
        await tx.exchangeRequest.update({
          where: { id: shipment.exchangeRequestId },
          data: {
            ...updateData,
            auditLogs: {
              create: {
                action: "BOSTA_WEBHOOK_PROCESSED",
                actorType: "SYSTEM",
                metadata: { state: payload.state, type: payload.type },
              },
            },
          },
        });
      }

      await tx.bostaWebhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
    });

    logger.info(
      { exchangeRequestId: shipment.exchangeRequestId, state: payload.state },
      "bosta_webhook_processed"
    );

    return { deduplicated: false, matched: true };
  }
}
