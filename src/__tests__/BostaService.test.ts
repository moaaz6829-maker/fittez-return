import axios from "axios";
import {
  BOSTA_EXCHANGE_TYPE_CODE,
  BostaService,
  buildExchangeDeliveryPayload,
  isAllowedBostaSourceIp,
  verifyWebhookSharedSecret,
  BOSTA_WEBHOOK_SOURCE_IPS,
} from "../services/BostaService";

jest.mock("axios");

describe("BostaService.createExchange - endpoint and method (verified)", () => {
  it("POSTs to /deliveries?apiVersion=1 with the type-30 payload", async () => {
    const post = jest.fn().mockResolvedValue({
      data: { _id: "bosta_shipment_1", trackingNumber: "TRK555" },
    });
    (axios.create as jest.Mock).mockReturnValue({ post });

    const service = new BostaService("test-api-key", "https://app.bosta.co/api/v2");

    const result = await service.createExchange({
      businessReference: "FITTEZ-EXCHANGE-10452-1",
      businessLocationId: "loc_1",
      receiver: { fullName: "Sara Ahmed", phone: "+201001234567" },
      dropOffAddress: { city: "Cairo", firstLine: "12 Test St" },
      cod: 217.4,
      packageDescription: "Exchange for order #10452",
      itemsCount: 1,
    });

    expect(post).toHaveBeenCalledTimes(1);
    const [calledUrl, calledPayload] = post.mock.calls[0];
    expect(calledUrl).toBe("/deliveries?apiVersion=1");
    expect(calledPayload.type).toBe(BOSTA_EXCHANGE_TYPE_CODE);
    expect(calledPayload.specs.packageDetails.description).toBe("Exchange for order #10452");
    expect(result.bostaShipmentId).toBe("bosta_shipment_1");
    expect(result.bostaTrackingNumber).toBe("TRK555");
  });

  it("uses the raw API key with no Bearer prefix in the Authorization header", () => {
    (axios.create as jest.Mock).mockReturnValue({ post: jest.fn() });
    new BostaService("my-raw-key", "https://app.bosta.co/api/v2");

    const createCall = (axios.create as jest.Mock).mock.calls[0][0];
    expect(createCall.headers.Authorization).toBe("my-raw-key");
  });
});

describe("BostaService payload shape (verified against docs.bosta.co)", () => {
  const baseParams = {
    businessReference: "FITTEZ-EXCHANGE-10452-123",
    businessLocationId: "loc_1",
    receiver: { fullName: "Sara Ahmed", phone: "+201001234567" },
    dropOffAddress: { city: "Cairo", firstLine: "12 Test St" },
    cod: 217.4,
    packageDescription: "Exchange for order #10452",
    itemsCount: 2,
  };

  it("uses type = 30 for Exchange", () => {
    const payload = buildExchangeDeliveryPayload(baseParams);
    expect(payload.type).toBe(30);
    expect(BOSTA_EXCHANGE_TYPE_CODE).toBe(30);
  });

  it("nests packageType and packageDetails under specs, per verified docs", () => {
    const payload = buildExchangeDeliveryPayload(baseParams);
    expect(payload.specs).toEqual({
      packageType: "Small",
      packageDetails: {
        description: "Exchange for order #10452",
        itemsCount: 2,
      },
    });
    // Must NOT be present at the top level.
    expect((payload as any).packageDetails).toBeUndefined();
    expect((payload as any).packageType).toBeUndefined();
  });

  it("respects an explicit packageType override", () => {
    const payload = buildExchangeDeliveryPayload({ ...baseParams, packageType: "MEDIUM" });
    expect(payload.specs.packageType).toBe("MEDIUM");
  });

  it("sends businessReference but never uniqueBusinessReference", () => {
    const payload = buildExchangeDeliveryPayload(baseParams) as Record<string, unknown>;
    expect(payload.businessReference).toBe(baseParams.businessReference);
    expect(payload.uniqueBusinessReference).toBeUndefined();
  });

  it("never sends an original-tracking-linkage field (confirmed unsupported)", () => {
    const payload = buildExchangeDeliveryPayload(baseParams) as Record<string, unknown>;
    expect(payload.originalTrackingNumber).toBeUndefined();
    expect(payload.originalShipmentId).toBeUndefined();
    expect(payload.exchangeForTrackingNumber).toBeUndefined();
  });
});

describe("Webhook trust model (documented mechanisms only, no HMAC)", () => {
  it("recognizes Bosta's two documented webhook source IPs", () => {
    expect(isAllowedBostaSourceIp("34.89.199.241")).toBe(true);
    expect(isAllowedBostaSourceIp("35.246.223.19")).toBe(true);
    expect(BOSTA_WEBHOOK_SOURCE_IPS).toHaveLength(2);
  });

  it("rejects an IP not in the documented allowlist", () => {
    expect(isAllowedBostaSourceIp("1.2.3.4")).toBe(false);
    expect(isAllowedBostaSourceIp(undefined)).toBe(false);
  });

  it("accepts a matching shared-secret header value", () => {
    expect(verifyWebhookSharedSecret("my-secret-123", "my-secret-123")).toBe(true);
  });

  it("rejects a mismatched shared-secret header value", () => {
    expect(verifyWebhookSharedSecret("wrong-secret", "my-secret-123")).toBe(false);
  });

  it("rejects a missing header or missing configured secret", () => {
    expect(verifyWebhookSharedSecret(undefined, "my-secret-123")).toBe(false);
    expect(verifyWebhookSharedSecret("my-secret-123", "")).toBe(false);
  });

  it("rejects values of different length without throwing", () => {
    expect(() => verifyWebhookSharedSecret("short", "a-much-longer-secret-value")).not.toThrow();
    expect(verifyWebhookSharedSecret("short", "a-much-longer-secret-value")).toBe(false);
  });
});
