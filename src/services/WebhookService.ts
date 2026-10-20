import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { sendExchangeOutForDelivery, sendExchangeDelivered } from "./EmailService";

/**
 * Bosta's webhook payload has no unique event id, so our idempotency key is
 * synthesized from `${trackingNumber}:${state}:${timeStamp}`.
 */
function synthesizeIdempotencyKey(payload: {
  trackingNumber: string;
  state: number;
  timeStamp: number;
}): string {
  return `${payload.trackingNumber}:${payload.state}:${payload.timeStamp}`;
}

/**
 * Numeric Bosta state codes (docs.bosta.co "Bosta States"). Several codes mean
 * different things per order type, so the mapping is only applied when the
 * webhook's `type` is "EXCHANGE".
 * OUT_FOR_DELIVERY (41) and DELIVERED (45) are the standard Bosta codes.
 */
export const BOSTA_EXCHANGE_STATE_CODES = {
  PICKUP_REQUESTED: 10,
  ROUTE_ASSIGNED: 20,
  PICKED_UP_FROM_BUSINESS: 21,
  PICKING_UP_FROM_CONSIGNEE: 22,
  PICKED_UP_FROM_CONSIGNEE: 23,
  RECEIVED_AT_WAREHOUSE: 24,
  IN_TRANSIT_BETWEEN_HUBS: 30,
  OUT_FOR_DELIVERY: 41,
  DELIVERED: 45,
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
  [BOSTA_EXCHANGE_STATE_CODES.OUT_FOR_DELIVERY]: "REPLACEMENT_SHIPPED",
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
      update: {},
    });

    if (!shipment) {
      logger.warn({ trackingNumber: payload.trackingNumber }, "bosta_webhook_no_matching_shipment");
      await prisma.bostaWebhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
      return { deduplicated: false, matched: false };
    }

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

      // State 46 ONLY updates status/returnStatus. No Shopify inventory change here.
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

    // Customer emails (phase 2 and 3). The event is deduplicated above, so each
    // email is sent once. Failures here never fail the webhook.
    if (payload.type === "EXCHANGE" &&
        (payload.state === BOSTA_EXCHANGE_STATE_CODES.OUT_FOR_DELIVERY ||
         payload.state === BOSTA_EXCHANGE_STATE_CODES.DELIVERED)) {
      try {
        const ex = await prisma.exchangeRequest.findUnique({ where: { id: shipment.exchangeRequestId } });
        if (ex) {
          const data = {
            customerEmail: ex.customerEmail,
            customerName: ex.customerName,
            orderName: ex.shopifyOrderName,
            trackingNumber: ex.bostaTrackingNumber ?? payload.trackingNumber,
          };
          if (payload.state === BOSTA_EXCHANGE_STATE_CODES.OUT_FOR_DELIVERY) {
            await sendExchangeOutForDelivery(data);
          } else {
            await sendExchangeDelivered(data);
          }
        }
      } catch (err) {
        logger.error({ err: (err as Error).message }, "exchange_status_email_failed");
      }
    }

    logger.info(
      { exchangeRequestId: shipment.exchangeRequestId, state: payload.state },
      "bosta_webhook_processed"
    );

    return { deduplicated: false, matched: true };
  }
}
