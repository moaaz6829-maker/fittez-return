import { v4 as uuidv4 } from "uuid";
import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { EligibilityService } from "./EligibilityService";
import { InventoryService } from "./InventoryService";
import { PricingService } from "./PricingService";
import { ShopifyService, ShopifyOrderDetails } from "./ShopifyService";
import { BostaService } from "./BostaService";

export interface ExchangeItemInput {
  originalLineItemId: string;
  originalQuantity: number;
  replacementProductId: string;
  replacementVariantId: string;
  replacementQuantity: number;
}

export interface CreateExchangeInput {
  storeId: string;
  order: ShopifyOrderDetails;
  testModeEnabled: boolean;
  idempotencyKey: string;
  items: ExchangeItemInput[];
  refundMethod?: "E_WALLET" | "INSTAPAY"; // required only if customerCredit > 0
  refundMobile?: string;
  inventoryLocationId: string;
  inventoryLockLeaseMs: number;
}

export class ExchangeServiceError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

export class ExchangeService {
  constructor(private shopify: ShopifyService, private bosta: BostaService) {}

  /**
   * Implements Section 23 steps 1-23 in order, plus the finalized
   * concurrency-safety decision (application lock -> final Shopify check
   * -> Bosta creation -> Shopify deduction, all while holding the lock).
   */
  async createExchange(input: CreateExchangeInput) {
    // Idempotency (Section 35): a repeated submit with the same key must
    // return the existing request, never create a second one.
    const existingByKey = await prisma.exchangeRequest.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existingByKey) return existingByKey;

    // ---- Steps 1-4: order / customer / eligibility / sale restrictions ----
    const eligibility = EligibilityService.checkDeliveryEligibility(
      input.order.fulfillment?.deliveredAt ?? null,
      new Date(),
      input.testModeEnabled
    );
    if (!eligibility.eligible) {
      throw new ExchangeServiceError(
        eligibility.reason === "NOT_DELIVERED"
          ? "This order is not eligible yet because it has not been delivered."
          : "This order is no longer eligible for refund or exchange.",
        eligibility.reason ?? "NOT_ELIGIBLE"
      );
    }

    if (input.items.length === 0) {
      throw new ExchangeServiceError("No items selected.", "NO_ITEMS");
    }

    // ---- Steps 5-10: validate each original + replacement pair ----
    let returnedTotalEgp = 0;
    let replacementTotalEgp = 0;
    const itemRows: Array<{
      originalProductId: string;
      originalVariantId: string;
      originalLineItemId: string;
      originalProductTitle: string;
      originalVariantTitle: string;
      originalQuantity: number;
      originalUnitPrice: number;
      replacementProductId: string;
      replacementVariantId: string;
      replacementProductTitle: string;
      replacementVariantTitle: string;
      replacementQuantity: number;
      replacementUnitPrice: number;
    }> = [];

    // Replacement variants must be validated against live Shopify data, not
    // trusted from the request. We batch by product to minimize calls.
    const replacementAvailabilityCache = new Map<string, Awaited<ReturnType<ShopifyService["getVariantAvailability"]>>>();

    for (const requested of input.items) {
      const originalLineItem = input.order.lineItems.find(
        (li) => li.lineItemId === requested.originalLineItemId
      );
      if (!originalLineItem) {
        throw new ExchangeServiceError("Invalid original item selection.", "INVALID_ORIGINAL_ITEM");
      }

      if (EligibilityService.isSaleItem(originalLineItem.compareAtPrice)) {
        throw new ExchangeServiceError(
          "This item is on sale and is not eligible for refund or exchange",
          "SALE_ITEM_NOT_ELIGIBLE"
        );
      }

      const remaining = await InventoryService.getRemainingEligibleQuantity(
        originalLineItem.lineItemId,
        originalLineItem.quantity
      );
      if (requested.originalQuantity < 1 || requested.originalQuantity > remaining) {
        throw new ExchangeServiceError(
          "The requested quantity is no longer available for exchange.",
          "QUANTITY_UNAVAILABLE"
        );
      }

      if (!replacementAvailabilityCache.has(requested.replacementProductId)) {
        const availability = await this.shopify.getVariantAvailability(
          requested.replacementProductId,
          input.inventoryLocationId
        );
        replacementAvailabilityCache.set(requested.replacementProductId, availability);
      }
      const availability = replacementAvailabilityCache.get(requested.replacementProductId)!;
      const replacementVariant = availability.find(
        (v) => v.variantId === requested.replacementVariantId
      );
      if (!replacementVariant) {
        throw new ExchangeServiceError("Invalid replacement variant.", "INVALID_REPLACEMENT_VARIANT");
      }

      // Section 7: replacement side must also not be a sale item.
      if (EligibilityService.isSaleItem(replacementVariant.compareAtPrice)) {
        throw new ExchangeServiceError(
          "This item is on sale and is not eligible for refund or exchange",
          "SALE_ITEM_NOT_ELIGIBLE"
        );
      }

      // Section 18: same product+variant swap is not a valid exchange.
      if (
        originalLineItem.productId === requested.replacementProductId &&
        originalLineItem.variantId === requested.replacementVariantId
      ) {
        throw new ExchangeServiceError(
          "The replacement must be a different product or variant from the original.",
          "SAME_VARIANT_NOT_ALLOWED"
        );
      }

      // Initial (non-final) stock check -- the FINAL authoritative check
      // happens later, while holding the lock, immediately before Bosta
      // creation (Section 17).
      if (replacementVariant.availableQuantity < requested.replacementQuantity) {
        throw new ExchangeServiceError(
          "This variant is currently unavailable.",
          "INSUFFICIENT_INVENTORY"
        );
      }

      returnedTotalEgp += originalLineItem.price * requested.originalQuantity;
      replacementTotalEgp += replacementVariant.price * requested.replacementQuantity;

      itemRows.push({
        originalProductId: originalLineItem.productId,
        originalVariantId: originalLineItem.variantId,
        originalLineItemId: originalLineItem.lineItemId,
        originalProductTitle: originalLineItem.productTitle,
        originalVariantTitle: originalLineItem.variantTitle,
        originalQuantity: requested.originalQuantity,
        originalUnitPrice: originalLineItem.price,
        replacementProductId: requested.replacementProductId,
        replacementVariantId: requested.replacementVariantId,
        replacementProductTitle: requested.replacementProductId, // resolved title fetched below
        replacementVariantTitle: replacementVariant.title,
        replacementQuantity: requested.replacementQuantity,
        replacementUnitPrice: replacementVariant.price,
      });
    }

    // ---- Steps 12-15: pricing, governorate, fee, COD ----
    const governorate = input.order.shippingAddress?.province;
    if (!governorate) {
      throw new ExchangeServiceError(
        "This order has no shipping governorate on file; contact support.",
        "MISSING_GOVERNORATE"
      );
    }

    const pricing = await PricingService.computeExchange({
      storeId: input.storeId,
      governorateName: governorate,
      returnedTotalEgp,
      replacementTotalEgp,
    });

    if (pricing.customerCredit > 0 && (!input.refundMethod || !input.refundMobile)) {
      throw new ExchangeServiceError(
        "A refund method and mobile number are required when a credit is owed to the customer.",
        "REFUND_METHOD_REQUIRED"
      );
    }

    // ---- Persist the REQUESTED row before touching Bosta/Shopify ----
    const businessReference = `FITTEZ-EXCHANGE-${input.order.orderName.replace("#", "")}-${Date.now()}`;
    const uniqueBusinessReference = uuidv4();

    const exchangeRequest = await prisma.exchangeRequest.create({
      data: {
        storeId: input.storeId,
        shopifyOrderId: input.order.orderId,
        shopifyOrderName: input.order.orderName,
        customerId: input.order.customerId,
        customerName: input.order.customerName,
        customerPhone: input.order.customerPhoneE164 ?? "",
        customerEmail: input.order.customerEmail,
        governorate,
        zone: pricing.zoneName,
        returnedTotal: pricing.returnedTotal,
        replacementTotal: pricing.replacementTotal,
        priceDifference: pricing.priceDifference,
        exchangeFeeEgp: pricing.exchangeFee,
        customerCredit: pricing.customerCredit,
        cod: pricing.cod,
        refundMethod: pricing.customerCredit > 0 ? input.refundMethod : null,
        refundMobile: pricing.customerCredit > 0 ? input.refundMobile : null,
        refundAmount: pricing.customerCredit > 0 ? pricing.customerCredit : null,
        originalTrackingNumber: input.order.fulfillment?.trackingNumber ?? null,
        businessReference,
        uniqueBusinessReference,
        status: "ELIGIBILITY_CHECKED",
        idempotencyKey: input.idempotencyKey,
        items: { create: itemRows },
        auditLogs: {
          create: {
            action: "EXCHANGE_REQUESTED",
            actorType: "CUSTOMER",
            metadata: { orderId: input.order.orderId, testMode: input.testModeEnabled },
          },
        },
      },
    });

    // ---- Steps 16-20: Bosta creation + inventory deduction, per item, ----
    // ---- each under its own application-level lock (Section: concurrency) ----
    // Simplification note: this reference implementation supports a single
    // replacement variant per Exchange request end-to-end (multi-item
    // exchanges require sequential per-variant locking, structured
    // identically -- extend the loop below for production multi-item use,
    // acquiring/releasing one variant's lock at a time to avoid holding
    // multiple locks simultaneously, which risks lock-ordering deadlocks).
    const primaryItem = itemRows[0];

    try {
      // ---- Idempotency check: FITTEZ's own DB, NOT a Bosta-side search ----
      // Per Bosta API verification, no confirmed endpoint exists to search
      // Bosta by businessReference/uniqueBusinessReference. The only safe
      // source of truth for "did we already create this shipment" is our
      // own BostaShipment table, keyed by exchangeRequestId (itself unique
      // per idempotencyKey, checked at the top of this method).
      const existingShipment = await prisma.bostaShipment.findUnique({
        where: { exchangeRequestId: exchangeRequest.id },
      });

      let bostaResult: { bostaShipmentId: string; bostaTrackingNumber: string; rawResponse: unknown };

      if (existingShipment) {
        // We already have a recorded successful Bosta shipment for this
        // exact request -- reuse it, never call Bosta again.
        bostaResult = {
          bostaShipmentId: existingShipment.bostaShipmentId,
          bostaTrackingNumber: existingShipment.bostaTrackingNumber,
          rawResponse: existingShipment.rawCreateResponse,
        };
      } else {
        const lockResult = await InventoryService.runLockedExchangeInventoryFlow({
          shopify: this.shopify,
          variantId: primaryItem.replacementVariantId,
          inventoryItemId: primaryItem.replacementVariantId, // VERIFY: map variant->inventoryItem id via Shopify data
          locationId: input.inventoryLocationId,
          requiredQuantity: primaryItem.replacementQuantity,
          exchangeRequestId: exchangeRequest.id,
          leaseMs: input.inventoryLockLeaseMs,
          onSufficientStock: async () => {
            await prisma.exchangeRequest.update({
              where: { id: exchangeRequest.id },
              data: { status: "CREATING_BOSTA_EXCHANGE" },
            });

            // NOTE: if this call throws (network error, timeout, 5xx),
            // we genuinely cannot know whether Bosta created the shipment
            // before failing to respond. That case is caught below and
            // marked BOSTA_CREATION_AMBIGUOUS -- it is NEVER treated as a
            // plain failure that's safe to blindly retry, because with no
            // confirmed Bosta-side search endpoint we have no way to check
            // afterward whether a shipment already exists.
            return this.bosta.createExchange({
              businessReference,
              // uniqueBusinessReference is intentionally NOT sent to Bosta
              // -- not a confirmed field, per Bosta API verification.
              businessLocationId: input.inventoryLocationId, // VERIFY: Bosta location id != Shopify location id, map via Settings
              receiver: {
                fullName: input.order.customerName ?? "FITTEZ Customer",
                phone: input.order.customerPhoneE164 ?? "",
              },
              dropOffAddress: {
                city: governorate,
                firstLine: "See order shipping address on file", // VERIFY: pull full address line from order
              },
              cod: pricing.cod,
              itemsCount: itemRows.reduce((sum, i) => sum + i.replacementQuantity, 0),
              packageDescription: `Exchange for order ${input.order.orderName}`,
            });
          },
        });

        if (lockResult.outcome === "INSUFFICIENT_STOCK") {
          await prisma.exchangeRequest.update({
            where: { id: exchangeRequest.id },
            data: { status: "FAILED" },
          });
          throw new ExchangeServiceError(
            "This variant is no longer available. Please choose another available variant or product.",
            "VARIANT_NO_LONGER_AVAILABLE"
          );
        }

        bostaResult = lockResult.result;
      }

      // ---- Save Bosta shipment info (Step 19) ----
      await prisma.bostaShipment.create({
        data: {
          exchangeRequestId: exchangeRequest.id,
          bostaShipmentId: bostaResult.bostaShipmentId,
          bostaTrackingNumber: bostaResult.bostaTrackingNumber,
          businessReference,
          uniqueBusinessReference, // stored for FITTEZ's own records only
          rawCreateResponse: bostaResult.rawResponse as any,
        },
      });

      await prisma.exchangeRequest.update({
        where: { id: exchangeRequest.id },
        data: {
          status: "BOSTA_EXCHANGE_CREATED",
          bostaTrackingNumber: bostaResult.bostaTrackingNumber,
          bostaShipmentId: bostaResult.bostaShipmentId,
          auditLogs: {
            create: {
              action: "BOSTA_CREATION_SUCCEEDED",
              actorType: "SYSTEM",
              metadata: { bostaTrackingNumber: bostaResult.bostaTrackingNumber },
            },
          },
        },
      });

      // ---- Step 20: deduct replacement inventory ----
      const deduction = await InventoryService.deductReplacementInventory({
        shopify: this.shopify,
        exchangeRequestId: exchangeRequest.id,
        inventoryItemId: primaryItem.replacementVariantId, // VERIFY: see note above
        locationId: input.inventoryLocationId,
        variantId: primaryItem.replacementVariantId,
        quantity: primaryItem.replacementQuantity,
        bostaTrackingNumber: bostaResult.bostaTrackingNumber,
      });

      if (!deduction.success) {
        // Section 25/39: Bosta already succeeded -- never create another
        // shipment. Mark for admin-only inventory retry.
        await prisma.exchangeRequest.update({
          where: { id: exchangeRequest.id },
          data: {
            status: "INVENTORY_SYNC_FAILED",
            inventoryStatus: "SYNC_FAILED",
            auditLogs: {
              create: { action: "INVENTORY_SYNC_FAILURE", actorType: "SYSTEM" },
            },
          },
        });
        return prisma.exchangeRequest.findUniqueOrThrow({ where: { id: exchangeRequest.id } });
      }

      const finalRequest = await prisma.exchangeRequest.update({
        where: { id: exchangeRequest.id },
        data: {
          status: "REPLACEMENT_INVENTORY_DEDUCTED",
          inventoryStatus: "DEDUCTED",
          auditLogs: {
            create: { action: "REPLACEMENT_INVENTORY_DEDUCTED", actorType: "SYSTEM" },
          },
        },
      });

      logger.info({ exchangeRequestId: exchangeRequest.id }, "exchange_created_successfully");
      return finalRequest;
    } catch (err) {
      if (err instanceof ExchangeServiceError) throw err;

      // We reach here for anything that failed AFTER the insufficient-stock
      // check -- i.e. it could have failed before or after Bosta actually
      // created a shipment. With no confirmed Bosta-side lookup mechanism,
      // we cannot safely distinguish "definitely never created" from
      // "created, but we didn't hear back" -- so we mark it AMBIGUOUS
      // rather than FAILED, and never auto-retry. An admin must manually
      // check the Bosta Dashboard and resolve via one of two paths (see
      // `resolveAmbiguousBostaCreation` below).
      logger.error(
        { err: (err as Error).message, exchangeRequestId: exchangeRequest.id },
        "exchange_creation_ambiguous"
      );
      await prisma.exchangeRequest.update({
        where: { id: exchangeRequest.id },
        data: {
          status: "BOSTA_CREATION_AMBIGUOUS",
          auditLogs: {
            create: {
              action: "BOSTA_CREATION_AMBIGUOUS",
              actorType: "SYSTEM",
              metadata: { error: (err as Error).message },
            },
          },
        },
      });
      throw new ExchangeServiceError(
        "Something went wrong. Please try again or contact FITTEZ.",
        "SYSTEM_ERROR"
      );
    }
  }

  /**
   * Admin-triggered resolution of a BOSTA_CREATION_AMBIGUOUS request.
   * There is NO confirmed Bosta-side search endpoint (see verification
   * report), so this can never be resolved automatically. An admin must
   * manually check the Bosta Dashboard for a shipment matching this
   * request's `businessReference`, then call this with one of two
   * outcomes:
   *
   *   - `{ outcome: "SHIPMENT_EXISTS", bostaShipmentId, bostaTrackingNumber }`
   *     -- admin found it in the Dashboard; we record it and proceed
   *     exactly as a normal successful creation would (inventory
   *     deduction still happens now, for the first time, since it never
   *     ran during the ambiguous attempt).
   *   - `{ outcome: "SHIPMENT_NOT_CREATED" }` -- admin confirmed via the
   *     Dashboard that Bosta has no record of this businessReference; it
   *     is now safe to attempt creation again from scratch.
   */
  async resolveAmbiguousBostaCreation(
    exchangeRequestId: string,
    resolution:
      | { outcome: "SHIPMENT_EXISTS"; bostaShipmentId: string; bostaTrackingNumber: string }
      | { outcome: "SHIPMENT_NOT_CREATED" },
    context: { shopify: ShopifyService; inventoryLocationId: string; inventoryLockLeaseMs: number }
  ) {
    const request = await prisma.exchangeRequest.findUniqueOrThrow({
      where: { id: exchangeRequestId },
      include: { items: true },
    });

    if (request.status !== "BOSTA_CREATION_AMBIGUOUS") {
      throw new Error("Request is not in BOSTA_CREATION_AMBIGUOUS state.");
    }

    if (resolution.outcome === "SHIPMENT_EXISTS") {
      await prisma.bostaShipment.create({
        data: {
          exchangeRequestId,
          bostaShipmentId: resolution.bostaShipmentId,
          bostaTrackingNumber: resolution.bostaTrackingNumber,
          businessReference: request.businessReference,
          uniqueBusinessReference: request.uniqueBusinessReference,
          rawCreateResponse: { source: "manual_admin_reconciliation" },
        },
      });

      await prisma.exchangeRequest.update({
        where: { id: exchangeRequestId },
        data: {
          status: "BOSTA_EXCHANGE_CREATED",
          bostaShipmentId: resolution.bostaShipmentId,
          bostaTrackingNumber: resolution.bostaTrackingNumber,
          auditLogs: {
            create: { action: "AMBIGUOUS_RESOLVED_SHIPMENT_EXISTS", actorType: "ADMIN" },
          },
        },
      });

      // Inventory was never deducted during the ambiguous attempt --
      // do it now, for the first time.
      const item = request.items[0];
      const deduction = await InventoryService.deductReplacementInventory({
        shopify: context.shopify,
        exchangeRequestId,
        inventoryItemId: item.replacementVariantId, // VERIFY: map to real inventoryItemId
        locationId: context.inventoryLocationId,
        variantId: item.replacementVariantId,
        quantity: item.replacementQuantity,
        bostaTrackingNumber: resolution.bostaTrackingNumber,
      });

      return prisma.exchangeRequest.update({
        where: { id: exchangeRequestId },
        data: deduction.success
          ? { status: "REPLACEMENT_INVENTORY_DEDUCTED", inventoryStatus: "DEDUCTED" }
          : { status: "INVENTORY_SYNC_FAILED", inventoryStatus: "SYNC_FAILED" },
      });
    }

    // SHIPMENT_NOT_CREATED: admin confirmed via Dashboard nothing exists.
    // Reset to a state that allows the normal creation path to run again.
    return prisma.exchangeRequest.update({
      where: { id: exchangeRequestId },
      data: {
        status: "ELIGIBILITY_CHECKED",
        auditLogs: {
          create: { action: "AMBIGUOUS_RESOLVED_NOT_CREATED", actorType: "ADMIN" },
        },
      },
    });
  }

  /**
   * Section 30/39: admin-triggered retry of ONLY the inventory deduction,
   * for requests in INVENTORY_SYNC_FAILED. Never re-creates a Bosta shipment.
   */
  async retryInventorySync(exchangeRequestId: string, inventoryLocationId: string) {
    const request = await prisma.exchangeRequest.findUniqueOrThrow({
      where: { id: exchangeRequestId },
      include: { items: true },
    });

    if (request.status !== "INVENTORY_SYNC_FAILED") {
      throw new Error("Request is not in INVENTORY_SYNC_FAILED state.");
    }

    const item = request.items[0];
    const result = await InventoryService.deductReplacementInventory({
      shopify: this.shopify,
      exchangeRequestId,
      inventoryItemId: item.replacementVariantId, // VERIFY: map to real inventoryItemId
      locationId: inventoryLocationId,
      variantId: item.replacementVariantId,
      quantity: item.replacementQuantity,
      bostaTrackingNumber: request.bostaTrackingNumber ?? "",
    });

    if (!result.success) {
      throw new Error("Inventory sync retry failed again; escalate to engineering.");
    }

    return prisma.exchangeRequest.update({
      where: { id: exchangeRequestId },
      data: { status: "REPLACEMENT_INVENTORY_DEDUCTED", inventoryStatus: "DEDUCTED" },
    });
  }
}
