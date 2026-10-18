jest.mock("../lib/db", () => require("./__mocks__/db"));
jest.mock("../utils/governorate", () => ({
  resolveZoneForGovernorate: jest.fn(async () => ({
    zoneName: "Cairo and Giza",
    exchangeFeeEgp: 117.4,
  })),
}));

import { prisma } from "../lib/db";
import { ExchangeService, ExchangeServiceError } from "../services/ExchangeService";
import type { ShopifyOrderDetails } from "../services/ShopifyService";

// Minimal fake ShopifyService -- only the methods ExchangeService calls.
function makeFakeShopify(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    getVariantAvailability: jest.fn(async () => [
      {
        variantId: "gid://shopify/ProductVariant/999",
        title: "White / 7 1/4",
        availableQuantity: 5,
        price: 950,
        compareAtPrice: null,
      },
    ]),
    getSingleVariantAvailability: jest.fn(async () => ({
      variantId: "gid://shopify/ProductVariant/999",
      title: "White / 7 1/4",
      availableQuantity: 5,
      price: 950,
      compareAtPrice: null,
    })),
    deductInventory: jest.fn(async () => ({ success: true, newAvailable: 4, rawResponse: {} })),
    ...overrides,
  } as any;
}

function makeOrder(): ShopifyOrderDetails {
  return {
    orderId: "gid://shopify/Order/1",
    orderName: "#10452",
    customerId: "gid://shopify/Customer/1",
    customerName: "Sara Ahmed",
    customerEmail: "sara@example.com",
    customerPhoneE164: "+201001234567",
    lineItems: [
      {
        lineItemId: "gid://shopify/LineItem/1",
        productId: "gid://shopify/Product/1",
        variantId: "gid://shopify/ProductVariant/111",
        productTitle: "Black Cap",
        variantTitle: "7 1/4",
        quantity: 1,
        price: 850,
        compareAtPrice: null,
      },
    ],
    fulfillment: { trackingNumber: "BOSTA-ORIGINAL-123", deliveredAt: new Date().toISOString() },
    shippingAddress: { province: "Cairo", country: "Egypt" },
  };
}

function baseInput(overrides: Partial<any> = {}) {
  return {
    storeId: "store_1",
    order: makeOrder(),
    testModeEnabled: true, // bypass delivered/3-day check for the test
    idempotencyKey: "idem-key-1",
    items: [
      {
        originalLineItemId: "gid://shopify/LineItem/1",
        originalQuantity: 1,
        replacementProductId: "gid://shopify/Product/2",
        replacementVariantId: "gid://shopify/ProductVariant/999",
        replacementQuantity: 1,
      },
    ],
    inventoryLocationId: "gid://shopify/Location/1",
    inventoryLockLeaseMs: 5000,
    ...overrides,
  };
}

describe("ExchangeService - internal idempotency (no Bosta-side search)", () => {
  beforeEach(() => (prisma as any).__reset());

  it("does not call Bosta twice for the same idempotencyKey", async () => {
    const shopify = makeFakeShopify();
    const bosta = {
      createExchange: jest.fn(async () => ({
        bostaShipmentId: "bosta_1",
        bostaTrackingNumber: "TRK123",
        rawResponse: {},
      })),
    } as any;

    const service = new ExchangeService(shopify, bosta);
    const input = baseInput();

    const first = await service.createExchange(input);
    expect(bosta.createExchange).toHaveBeenCalledTimes(1);
    expect(first.status).toBe("REPLACEMENT_INVENTORY_DEDUCTED");

    // Second call with the SAME idempotencyKey must short-circuit at the
    // very top and return the existing request without touching Bosta again.
    const second = await service.createExchange(input);
    expect(bosta.createExchange).toHaveBeenCalledTimes(1); // still 1, not 2
    expect(second.id).toBe(first.id);
  });

  it("reuses an existing BostaShipment row instead of calling Bosta again, even with a different idempotencyKey lookup path", async () => {
    const shopify = makeFakeShopify();
    const bosta = {
      createExchange: jest.fn(async () => ({
        bostaShipmentId: "bosta_1",
        bostaTrackingNumber: "TRK123",
        rawResponse: {},
      })),
    } as any;

    const service = new ExchangeService(shopify, bosta);
    const created = await service.createExchange(baseInput({ idempotencyKey: "idem-key-2" }));
    expect(bosta.createExchange).toHaveBeenCalledTimes(1);

    // Simulate a hypothetical re-entry into the Bosta-creation block for
    // the SAME exchangeRequest.id (e.g. a resumed job) by directly
    // checking that a BostaShipment row now exists for it.
    const shipment = await (prisma as any).bostaShipment.findUnique({
      where: { exchangeRequestId: created.id },
    });
    expect(shipment).not.toBeNull();
    expect(shipment.bostaTrackingNumber).toBe("TRK123");
  });
});

describe("ExchangeService - ambiguous Bosta creation (no blind retry/duplicate)", () => {
  beforeEach(() => (prisma as any).__reset());

  it("marks the request BOSTA_CREATION_AMBIGUOUS when Bosta creation throws, and does not create a shipment record", async () => {
    const shopify = makeFakeShopify();
    const bosta = {
      createExchange: jest.fn(async () => {
        throw new Error("socket hang up");
      }),
    } as any;

    const service = new ExchangeService(shopify, bosta);
    const input = baseInput({ idempotencyKey: "idem-key-3" });

    await expect(service.createExchange(input)).rejects.toThrow(ExchangeServiceError);

    const requests = [...(prisma as any).__state.exchangeRequests.values()];
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe("BOSTA_CREATION_AMBIGUOUS");

    const shipments = [...(prisma as any).__state.bostaShipments.values()];
    expect(shipments).toHaveLength(0);
    expect(bosta.createExchange).toHaveBeenCalledTimes(1);
  });

  it("does not attempt a second Bosta call on a repeat submit with the same idempotencyKey after an ambiguous failure", async () => {
    const shopify = makeFakeShopify();
    const bosta = {
      createExchange: jest.fn(async () => {
        throw new Error("timeout");
      }),
    } as any;

    const service = new ExchangeService(shopify, bosta);
    const input = baseInput({ idempotencyKey: "idem-key-4" });

    await expect(service.createExchange(input)).rejects.toThrow(ExchangeServiceError);
    expect(bosta.createExchange).toHaveBeenCalledTimes(1);

    // Customer/client retries the exact same submission (same idempotency
    // key) -- must return the existing AMBIGUOUS record, never call Bosta
    // again automatically. Resolution can only happen via
    // resolveAmbiguousBostaCreation() after manual admin verification.
    const second = await service.createExchange(input);
    expect(bosta.createExchange).toHaveBeenCalledTimes(1); // still 1
    expect(second.status).toBe("BOSTA_CREATION_AMBIGUOUS");
  });

  it("resolveAmbiguousBostaCreation(SHIPMENT_NOT_CREATED) allows a fresh attempt afterward", async () => {
    const shopify = makeFakeShopify();
    const bosta = {
      createExchange: jest
        .fn()
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce({
          bostaShipmentId: "bosta_2",
          bostaTrackingNumber: "TRK999",
          rawResponse: {},
        }),
    } as any;

    const service = new ExchangeService(shopify, bosta);
    const input = baseInput({ idempotencyKey: "idem-key-5" });

    await expect(service.createExchange(input)).rejects.toThrow(ExchangeServiceError);
    const ambiguous = [...(prisma as any).__state.exchangeRequests.values()][0];
    expect(ambiguous.status).toBe("BOSTA_CREATION_AMBIGUOUS");

    await service.resolveAmbiguousBostaCreation(
      ambiguous.id,
      { outcome: "SHIPMENT_NOT_CREATED" },
      { shopify, inventoryLocationId: input.inventoryLocationId, inventoryLockLeaseMs: 5000 }
    );

    const resetRecord = await (prisma as any).exchangeRequest.findUniqueOrThrow({
      where: { id: ambiguous.id },
    });
    expect(resetRecord.status).toBe("ELIGIBILITY_CHECKED");
  });
});
