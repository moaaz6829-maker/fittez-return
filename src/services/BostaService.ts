import axios, { AxiosInstance } from "axios";
import crypto from "crypto";
import { logger } from "../lib/logger";

/**
 * Bosta integration. Endpoint, auth header (raw key, no "Bearer"), exchange
 * type code 30 and the webhook trust model are verified against Bosta's docs.
 * The receiver / dropOffAddress / cod shapes are isolated in
 * buildExchangeDeliveryPayload so they can be corrected in one place.
 * Bosta has no field linking an exchange to the original shipment, and no
 * confirmed search-by-reference endpoint, so retry safety lives in FITTEZ's DB.
 */

export const BOSTA_EXCHANGE_TYPE_CODE = 30;

/** Public Bosta tracking page the customer can open from the email. */
export function bostaTrackingUrl(trackingNumber: string): string {
  return `https://bosta.co/tracking-shipment/?lang=en&trackingNumber=${encodeURIComponent(trackingNumber)}`;
}
const BOSTA_EXCHANGE_ENDPOINT = "/deliveries?apiVersion=1";
export const BOSTA_WEBHOOK_SOURCE_IPS = ["34.89.199.241", "35.246.223.19"];

export interface CreateExchangeParams {
  businessReference: string;
  businessLocationId?: string;
  receiver: { firstName: string; lastName: string; phone: string; email?: string };
  dropOffAddress: { city: string; firstLine: string };
  cod: number;
  packageDescription: string;
  itemsCount: number;
  packageType?: "SMALL" | "MEDIUM" | "LARGE" | "Light Bulky" | "Heavy Bulky";
  notes?: string;
}

export interface CreateExchangeResult {
  bostaShipmentId: string;
  bostaTrackingNumber: string;
  rawResponse: unknown;
}

export function buildExchangeDeliveryPayload(params: CreateExchangeParams) {
  return {
    type: BOSTA_EXCHANGE_TYPE_CODE,
    businessReference: params.businessReference,
    businessLocationId: params.businessLocationId,
    dropOffAddress: params.dropOffAddress,
    receiver: params.receiver,
    cod: params.cod,
    notes: params.notes,
    specs: {
      packageType: "Parcel",
      size: "SMALL",
      packageDetails: {
        description: params.packageDescription,
        itemsCount: params.itemsCount,
      },
    },
  };
}

export class BostaService {
  private client: AxiosInstance;

  constructor(apiKey: string, baseUrl: string) {
    this.client = axios.create({
      baseURL: baseUrl,
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      timeout: 20000,
    });
  }

  async testConnection(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.client.get("/pickup-locations");
      return { ok: true };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "bosta_connection_test_failed");
      return { ok: false, detail: "Unable to authenticate with Bosta" };
    }
  }

  async createExchange(params: CreateExchangeParams): Promise<CreateExchangeResult> {
    const payload = buildExchangeDeliveryPayload(params);

    let res;
    try {
      res = await this.client.post(BOSTA_EXCHANGE_ENDPOINT, payload);
    } catch (err: any) {
      // Log Bosta's own rejection message (never the API key) so a 400 can be
      // diagnosed. The payload contains customer details, so it is not logged.
      logger.error(
        { status: err?.response?.status, bostaResponse: err?.response?.data },
        "bosta_create_exchange_rejected"
      );
      throw err;
    }
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

export function isAllowedBostaSourceIp(ip: string | undefined): boolean {
  if (!ip) return false;
  return BOSTA_WEBHOOK_SOURCE_IPS.includes(ip);
}

export function verifyWebhookSharedSecret(
  receivedHeaderValue: string | undefined,
  configuredSecret: string
): boolean {
  if (!receivedHeaderValue || !configuredSecret) return false;
  const received = Buffer.from(receivedHeaderValue);
  const configured = Buffer.from(configuredSecret);
  if (received.length !== configured.length) {
    crypto.timingSafeEqual(Buffer.alloc(configured.length), Buffer.alloc(configured.length));
    return false;
  }
  return crypto.timingSafeEqual(received, configured);
}
