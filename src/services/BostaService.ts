import axios, { AxiosInstance } from "axios";
import crypto from "crypto";
import { logger } from "../lib/logger";

/**
 * ============================================================
 * BOSTA VERIFICATION STATUS
 * ============================================================
 * Verified against Bosta's official static documentation
 * (https://docs.bosta.co/docs/how-to/*) on the date this file was last
 * updated. The interactive API Reference (https://docs.bosta.co/api) is a
 * client-side-rendered Redoc/Swagger UI that could not be fetched
 * programmatically, so anything that ONLY lives there is marked
 * NOT VERIFIED below and must not be relied upon in production without
 * either rendering that page manually or getting written confirmation
 * from Bosta support.
 *
 * VERIFIED (see docs.bosta.co "Create Your First Delivery",
 * "Get Your API Key", "Get Shipment Status via Webhook", "Whitelisting"):
 *   - Endpoint: POST https://app.bosta.co/api/v2/deliveries?apiVersion=1
 *   - Auth header: `Authorization: <raw API key>` (no "Bearer" prefix)
 *   - Exchange type code = 30
 *   - Payload nesting: specs.packageType, specs.packageDetails.description,
 *     specs.packageDetails.itemsCount
 *   - dropOffAddress required for Exchange; pickupAddress/businessLocationId
 *     optional for Exchange (defaults to your default pickup location)
 *   - businessReference is a real, confirmed field (free-text, echoed back
 *     on the delivery object and on webhook payloads)
 *   - No field exists anywhere in the docs to link an Exchange to an
 *     original shipment/tracking number -- confirmed absent, not just
 *     unconfirmed. Correlation must stay entirely inside FITTEZ's DB.
 *   - Webhook delivery: your own endpoint, registered via the Bosta
 *     Dashboard (persists account-wide) or per-request via `webhookUrl`
 *     + optional `webhookCustomHeaders`. Bosta POSTs on every state change
 *     (never on creation).
 *   - Webhook payload fields/types: _id (String), trackingNumber (String),
 *     state (NUMBER, not a string), type (String enum), cod (Number),
 *     timeStamp (Number, epoch ms), isConfirmedDelivery (Boolean),
 *     deliveryPromiseDate (Date string DD-MM-YYYY), exceptionReason
 *     (String), exceptionCode (Number), businessReference (String),
 *     numberOfAttempts (Number).
 *   - Webhook trust model is documented as exactly two mechanisms, and
 *     NEITHER is a cryptographic signature:
 *       1. IP allowlisting of Bosta's own outbound calls:
 *          34.89.199.241 and 35.246.223.19.
 *       2. A static header name/value YOU configure via
 *          `webhookCustomHeaders` (or the Dashboard), which Bosta echoes
 *          back verbatim on every call -- you compare it yourself. This is
 *          a shared secret, not an HMAC/signature.
 *
 * NOT VERIFIED (absent from the static docs; only appear in unofficial
 * third-party SDKs, which are explicitly NOT treated as proof here):
 *   - Exact `receiver` object schema (field names, phone format)
 *   - Exact `cod` field name/placement in the create payload
 *   - Whether `goodsInfo` is required, and its schema
 *   - Whether `uniqueBusinessReference` exists as a distinct Bosta field
 *     at all, or whether Bosta deduplicates on it
 *   - Any dedicated "search by reference" endpoint (no such endpoint is
 *     documented; unofficial SDKs only show get-by-tracking-number and
 *     paginated list, never a businessReference search)
 *   - Whether the creation response is enveloped (`{ data: {...} }`) or flat
 *   - Exact dropOffAddress/pickupAddress field names (city/zone/district/etc)
 *   - A lightweight read-only endpoint suitable for a pure connectivity test
 *
 * CONSEQUENCE FOR THIS IMPLEMENTATION:
 *   - `uniqueBusinessReference` is NEVER sent to Bosta. It may still exist
 *     as a FITTEZ-internal value for our own idempotency bookkeeping, but
 *     it carries no guarantee from Bosta's side.
 *   - There is no `findByUniqueBusinessReference`-style Bosta lookup here.
 *     Retry safety is achieved entirely via FITTEZ's own database (see
 *     ExchangeService), never via a Bosta-side search.
 *   - `receiver`/`cod`/`goodsInfo` fields below are still included because
 *     SOME shape of them is almost certainly required for a working
 *     delivery (a shipment needs a recipient and a COD amount), but their
 *     exact key names are UNVERIFIED and must be confirmed via a real
 *     sandbox call (or Bosta support) before go-live. They are isolated in
 *     one place (`buildExchangeDeliveryPayload`) specifically so they're
 *     easy to correct once confirmed.
 * ============================================================
 */

export const BOSTA_EXCHANGE_TYPE_CODE = 30;

// VERIFIED: exact path + required query parameter.
const BOSTA_EXCHANGE_ENDPOINT = "/deliveries?apiVersion=1";

// VERIFIED: the two IPs Bosta itself documents as its outbound webhook
// source IPs (docs.bosta.co/docs/how-to/whitelisting).
export const BOSTA_WEBHOOK_SOURCE_IPS = ["34.89.199.241", "35.246.223.19"];

export interface CreateExchangeParams {
  businessReference: string; // VERIFIED real field; the only reference sent to Bosta
  businessLocationId?: string; // VERIFIED optional; VERIFY exact id source (Bosta location, not Shopify)
  receiver: {
    // NOT VERIFIED exact shape -- confirm against a real sandbox call.
    fullName: string;
    phone: string;
  };
  dropOffAddress: {
    // NOT VERIFIED exact shape -- confirm against a real sandbox call /
    // the "Format Bosta Address" doc page.
    city: string;
    firstLine: string;
  };
  cod: number; // NOT VERIFIED exact field name -- confirm before go-live
  packageDescription: string;
  itemsCount: number;
  packageType?: "SMALL" | "MEDIUM" | "LARGE" | "Light Bulky" | "Heavy Bulky"; // VERIFIED enum values
  notes?: string;
}

export interface CreateExchangeResult {
  bostaShipmentId: string;
  bostaTrackingNumber: string;
  rawResponse: unknown;
}

/**
 * Pure payload builder, exported separately so it can be unit-tested
 * without any network access. This is the ONLY place the verified vs.
 * unverified field shapes are assembled.
 */
export function buildExchangeDeliveryPayload(params: CreateExchangeParams) {
  return {
    type: BOSTA_EXCHANGE_TYPE_CODE, // VERIFIED
    businessReference: params.businessReference, // VERIFIED
    businessLocationId: params.businessLocationId, // VERIFIED optional
    dropOffAddress: params.dropOffAddress, // shape NOT VERIFIED
    receiver: params.receiver, // shape NOT VERIFIED
    cod: params.cod, // field name NOT VERIFIED
    notes: params.notes, // NOT VERIFIED whether accepted for Exchange
    specs: {
      // VERIFIED nesting per "Create Your First Delivery"
      packageType: params.packageType ?? "Small",
      packageDetails: {
        description: params.packageDescription,
        itemsCount: params.itemsCount,
      },
    },
    // Deliberately NOT included: uniqueBusinessReference (not a confirmed
    // Bosta field), originalTrackingNumber / any shipment-linking field
    // (confirmed not to exist), goodsInfo (schema not verified -- omitted
    // rather than guessed; insurance calculation may be affected until
    // this is confirmed with Bosta support).
  };
}

export class BostaService {
  private client: AxiosInstance;

  constructor(apiKey: string, baseUrl: string) {
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: apiKey, // VERIFIED: raw key, no "Bearer" prefix. Never logged.
        "Content-Type": "application/json",
      },
      timeout: 20000,
    });
  }

  /**
   * Section 43: connectivity/auth test only. Must NOT create a shipment.
   * NOT VERIFIED: no dedicated lightweight read-only endpoint is confirmed
   * in the static docs. Using pickup-locations as a plausible read-only
   * probe; confirm against the interactive API reference or Bosta support
   * before relying on this in production.
   */
  async testConnection(): Promise<{ ok: boolean; detail?: string }> {
    try {
      // NOT VERIFIED endpoint path -- see class doc comment.
      await this.client.get("/pickup-locations");
      return { ok: true };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "bosta_connection_test_failed");
      return { ok: false, detail: "Unable to authenticate with Bosta" };
    }
  }

  /**
   * Creates a real Bosta Exchange shipment (type 30) at the VERIFIED
   * endpoint. Caller (ExchangeService) is responsible for:
   *   - having already checked FITTEZ's own database for an existing
   *     BostaShipment tied to this request (NOT a Bosta-side search --
   *     see class doc comment, no such endpoint is confirmed to exist),
   *   - holding the application-level inventory lock,
   *   - only calling this AFTER the final Shopify inventory check passes,
   *   - NOT deducting Shopify inventory until this call succeeds,
   *   - treating a thrown error here as AMBIGUOUS (not "definitely
   *     failed"), since a timeout or dropped response gives no reliable
   *     way to know whether Bosta actually created the shipment.
   */
  async createExchange(params: CreateExchangeParams): Promise<CreateExchangeResult> {
    const payload = buildExchangeDeliveryPayload(params);

    const res = await this.client.post(BOSTA_EXCHANGE_ENDPOINT, payload);
    // NOT VERIFIED whether the response is enveloped in `data` -- handling
    // both shapes defensively rather than assuming one.
    const created = (res.data?.data ?? res.data) as any;

    if (!created?.trackingNumber && !created?._id) {
      logger.error({ rawResponse: res.data }, "bosta_create_exchange_unexpected_response_shape");
      throw new Error("Bosta Exchange creation returned an unexpected response shape");
    }

    return {
      bostaShipmentId: created._id ?? created.id,
      bostaTrackingNumber: created.trackingNumber,
      rawResponse: created,
    };
  }
}

/**
 * ------------------------------------------------------------------
 * Webhook trust verification -- documented mechanisms ONLY.
 * This is explicitly NOT a signature/HMAC scheme; Bosta does not offer
 * one per the current docs. Do not rename these to imply cryptographic
 * signing.
 * ------------------------------------------------------------------
 */

/**
 * VERIFIED mechanism #1: source IP allowlist. Only meaningful when the
 * deployment environment gives a reliable, unspoofable client IP (e.g.
 * behind a trusted load balancer that sets a verified header, or a direct
 * connection). If the environment cannot guarantee this, treat this check
 * as advisory only and rely on mechanism #2.
 */
export function isAllowedBostaSourceIp(ip: string | undefined): boolean {
  if (!ip) return false;
  return BOSTA_WEBHOOK_SOURCE_IPS.includes(ip);
}

/**
 * VERIFIED mechanism #2: a static shared value configured via
 * `webhookCustomHeaders` (or the Dashboard), echoed back verbatim by
 * Bosta on every webhook call. Compared in constant time to avoid timing
 * side-channels, but this is a shared-secret comparison, NOT signature
 * verification -- there is no payload signing involved. Never log either
 * value.
 */
export function verifyWebhookSharedSecret(
  receivedHeaderValue: string | undefined,
  configuredSecret: string
): boolean {
  if (!receivedHeaderValue || !configuredSecret) return false;

  const received = Buffer.from(receivedHeaderValue);
  const configured = Buffer.from(configuredSecret);

  if (received.length !== configured.length) {
    // Still perform a same-length dummy comparison so a length mismatch
    // doesn't return measurably faster than a same-length mismatch.
    crypto.timingSafeEqual(Buffer.alloc(configured.length), Buffer.alloc(configured.length));
    return false;
  }

  return crypto.timingSafeEqual(received, configured);
}
