import { v4 as uuidv4 } from "uuid";
import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { EligibilityService } from "./EligibilityService";
import { InventoryService } from "./InventoryService";
import { PricingService } from "./PricingService";
import { ShopifyService, ShopifyOrderDetails } from "./ShopifyService";
import { BostaService } from "./BostaService";
import {
  sendExchangeApproved, sendExchangeRejected, sendExchangeOutForDelivery, sendExchangeDelivered,
} from "./EmailService";

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

const PENDING = ["REQUESTED", "ELIGIBILITY_CHECKED", "BOSTA_CREATION_AMBIGUOUS"];

export class ExchangeServiceError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

/**
 * Exchange lifecycle (new):
 *  1. Customer submits  -> createExchange(): validates everything, saves the
 *     request as REQUESTED ("pending approval"). NO Bosta shipment, NO stock
 *     change.
 *  2. Admin approves    -> approveExchange(): final stock check, Bosta
 *     shipment, stock deduction, "approved" email with tracking link.
 *  3. Bosta webhooks    -> "out for delivery" / "delivered" emails
 *     (see WebhookService).
 *  An admin can also reject a pending request (rejectExchange).
 */
export class ExchangeService {
  constructor(private shopify: ShopifyService, private bosta?: BostaService) {}

  /** Step 1: validate + store the request. Nothing is shipped or deducted. */
  async createExchange(input: CreateExchangeInput) {
    const existingByKey = await prisma.exchangeRequest.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existingByKey) return existingByKey;

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

    // One open request per order: stop duplicate submissions.
    const openExchange = await prisma.exchangeRequest.findFirst({
      where: {
        shopifyOrderId: input.order.orderId,
        status: {
          in: [
            "REQUESTED", "ELIGIBILITY_CHECKED", "CREATING_BOSTA_EXCHANGE", "BOSTA_EXCHANGE_CREATED",
            "BOSTA_CREATION_AMBIGUOUS", "REPLACEMENT_INVENTORY_DEDUCTED", "REPLACEMENT_SHIPPED",
            "RETURN_IN_PROGRESS", "INVENTORY_SYNC_FAILED",
          ],
        },
      },
    });
    const openRefund = await prisma.refundRequest.findFirst({
      where: { shopifyOrderId: input.order.orderId, status: { in: ["PENDING", "APPROVED", "REFUNDED"] } },
    });
    if (openExchange || openRefund) {
      throw new ExchangeServiceError(
        "We're already working on a request for this order.",
        "ALREADY_OPEN"
      );
    }

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

    const replacementAvailabilityCache = new Map<
      string,
      Awaited<ReturnType<ShopifyService["getVariantAvailability"]>>
    >();

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
      const replacementVariant = availability.find((v) => v.variantId === requested.replacementVariantId);
      if (!replacementVariant) {
        throw new ExchangeServiceError("Invalid replacement variant.", "INVALID_REPLACEMENT_VARIANT");
      }

      if (EligibilityService.isSaleItem(replacementVariant.compareAtPrice)) {
        throw new ExchangeServiceError(
          "This item is on sale and is not eligible for refund or exchange",
          "SALE_ITEM_NOT_ELIGIBLE"
        );
      }

      if (
        originalLineItem.productId === requested.replacementProductId &&
        originalLineItem.variantId === requested.replacementVariantId
      ) {
        throw new ExchangeServiceError(
          "The replacement must be a different product or variant from the original.",
          "SAME_VARIANT_NOT_ALLOWED"
        );
      }

      if (replacementVariant.availableQuantity < requested.replacementQuantity) {
        throw new ExchangeServiceError("This variant is currently unavailable.", "INSUFFICIENT_INVENTORY");
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
        // Real product name (not the Shopify id) so the dashboard shows it.
        replacementProductTitle: replacementVariant.productTitle ?? "Product",
        replacementVariantTitle: replacementVariant.title,
        replacementQuantity: requested.replacementQuantity,
        replacementUnitPrice: replacementVariant.price,
      });
    }

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

    const businessReference = `FITTEZ-EXCHANGE-${input.order.orderName.replace("#", "")}-${Date.now()}`;
    const uniqueBusinessReference = uuidv4();

    return prisma.exchangeRequest.create({
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
        status: "REQUESTED", // = pending admin approval
        inventoryStatus: "PENDING",
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
  }

  /**
   * Step 2: admin approval (shipping is handled manually in Bosta).
   * Final stock check -> stock deduction -> "approved" email. Optionally stores
   * the Bosta tracking number the admin pasted, so the email carries a link.
   */
  async approveExchange(
    exchangeRequestId: string,
    ctx: { inventoryLocationId: string; inventoryLockLeaseMs: number },
    opts: { trackingNumber?: string } = {}
  ) {
    const request = await prisma.exchangeRequest.findUniqueOrThrow({
      where: { id: exchangeRequestId },
      include: { items: true },
    });

    if (!PENDING.includes(request.status as string)) {
      throw new ExchangeServiceError("This request was already processed.", "ALREADY_PROCESSED");
    }

    const order = await this.shopify.getOrderByName(request.shopifyOrderName);
    if (!order) {
      throw new ExchangeServiceError("The Shopify order could not be found.", "ORDER_NOT_FOUND");
    }

    for (const item of request.items) {
      const line = order.lineItems.find((l) => l.lineItemId === item.originalLineItemId);
      if (!line) throw new ExchangeServiceError("Original item not found on the order.", "INVALID_ORIGINAL_ITEM");
      const remaining = await InventoryService.getRemainingEligibleQuantity(line.lineItemId, line.quantity);
      if (item.originalQuantity > remaining) {
        throw new ExchangeServiceError(
          "The requested quantity is no longer available for exchange.",
          "QUANTITY_UNAVAILABLE"
        );
      }
    }

    // Final stock check on every replacement item.
    for (const item of request.items) {
      const v = await this.shopify.getSingleVariantAvailability(item.replacementVariantId, ctx.inventoryLocationId);
      if (!v || v.availableQuantity < item.replacementQuantity) {
        throw new ExchangeServiceError(
          "The replacement is out of stock right now, so this exchange can't be approved.",
          "VARIANT_NO_LONGER_AVAILABLE"
        );
      }
    }

    const tracking = opts.trackingNumber?.trim() || request.bostaTrackingNumber || null;

    // Deduct stock NOW (at approval), under the per-variant lock.
    const primary = request.items[0];
    const lockResult = await InventoryService.runLockedExchangeInventoryFlow({
      shopify: this.shopify,
      variantId: primary.replacementVariantId,
      inventoryItemId: primary.replacementVariantId,
      locationId: ctx.inventoryLocationId,
      requiredQuantity: primary.replacementQuantity,
      exchangeRequestId: request.id,
      leaseMs: ctx.inventoryLockLeaseMs,
      onSufficientStock: () =>
        this.deductAllItems(request.id, request.items, ctx.inventoryLocationId, tracking ?? ""),
    });

    if (lockResult.outcome === "INSUFFICIENT_STOCK") {
      throw new ExchangeServiceError(
        "The replacement is out of stock right now, so this exchange can't be approved.",
        "VARIANT_NO_LONGER_AVAILABLE"
      );
    }

    const deducted = lockResult.result;
    const updated = await prisma.exchangeRequest.update({
      where: { id: request.id },
      data: {
        status: deducted ? "REPLACEMENT_INVENTORY_DEDUCTED" : "INVENTORY_SYNC_FAILED",
        inventoryStatus: deducted ? "DEDUCTED" : "SYNC_FAILED",
        bostaTrackingNumber: tracking,
        auditLogs: { create: { action: "EXCHANGE_APPROVED", actorType: "ADMIN" } },
      },
    });

    void sendExchangeApproved({
      customerEmail: request.customerEmail,
      customerName: request.customerName,
      orderName: request.shopifyOrderName,
      trackingNumber: tracking,
    });

    logger.info({ exchangeRequestId: request.id }, "exchange_approved");
    return updated;
  }

  /** Save / change the Bosta tracking number of an approved exchange. */
  async setTracking(exchangeRequestId: string, trackingNumber: string) {
    return prisma.exchangeRequest.update({
      where: { id: exchangeRequestId },
      data: {
        bostaTrackingNumber: trackingNumber.trim() || null,
        auditLogs: { create: { action: "TRACKING_UPDATED", actorType: "ADMIN" } },
      },
    });
  }

  /** Manual step: the order is out for delivery -> status + email #2. */
  async markOutForDelivery(exchangeRequestId: string, trackingNumber?: string) {
    const request = await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: exchangeRequestId } });
    if (request.status !== "REPLACEMENT_INVENTORY_DEDUCTED" && request.status !== "INVENTORY_SYNC_FAILED") {
      throw new ExchangeServiceError("Approve this request first.", "NOT_APPROVED");
    }
    const tracking = trackingNumber?.trim() || request.bostaTrackingNumber || null;
    const updated = await prisma.exchangeRequest.update({
      where: { id: exchangeRequestId },
      data: {
        status: "REPLACEMENT_SHIPPED",
        bostaTrackingNumber: tracking,
        auditLogs: { create: { action: "MARKED_OUT_FOR_DELIVERY", actorType: "ADMIN" } },
      },
    });
    void sendExchangeOutForDelivery({
      customerEmail: request.customerEmail,
      customerName: request.customerName,
      orderName: request.shopifyOrderName,
      trackingNumber: tracking,
    });
    return updated;
  }

  /** Manual step: delivered -> status + email #3. */
  async markDelivered(exchangeRequestId: string) {
    const request = await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: exchangeRequestId } });
    if (!["REPLACEMENT_INVENTORY_DEDUCTED", "REPLACEMENT_SHIPPED", "INVENTORY_SYNC_FAILED"].includes(request.status as string)) {
      throw new ExchangeServiceError("Approve this request first.", "NOT_APPROVED");
    }
    const updated = await prisma.exchangeRequest.update({
      where: { id: exchangeRequestId },
      data: {
        status: "COMPLETED",
        auditLogs: { create: { action: "MARKED_DELIVERED", actorType: "ADMIN" } },
      },
    });
    void sendExchangeDelivered({
      customerEmail: request.customerEmail,
      customerName: request.customerName,
      orderName: request.shopifyOrderName,
      trackingNumber: request.bostaTrackingNumber,
    });
    return updated;
  }

  /** Admin rejects a pending request. Nothing was shipped or deducted. */
  async rejectExchange(exchangeRequestId: string, notes?: string) {
    const request = await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: exchangeRequestId } });
    if (!PENDING.includes(request.status as string)) {
      throw new ExchangeServiceError("This request was already processed.", "ALREADY_PROCESSED");
    }
    const updated = await prisma.exchangeRequest.update({
      where: { id: exchangeRequestId },
      data: {
        status: "REJECTED",
        inventoryStatus: "NOT_APPLICABLE",
        auditLogs: { create: { action: "EXCHANGE_REJECTED", actorType: "ADMIN", metadata: { notes } } },
      },
    });
    void sendExchangeRejected(
      {
        customerEmail: request.customerEmail,
        customerName: request.customerName,
        orderName: request.shopifyOrderName,
      },
      notes
    );
    return updated;
  }

  /** Deduct every replacement item from Shopify stock; true only if all succeeded. */
  private async deductAllItems(
    exchangeRequestId: string,
    items: Array<{ replacementVariantId: string; replacementQuantity: number }>,
    locationId: string,
    trackingNumber: string
  ): Promise<boolean> {
    let allOk = true;
    for (const item of items) {
      const info = await this.shopify.getSingleVariantAvailability(item.replacementVariantId, locationId);
      if (!info?.inventoryItemId) {
        allOk = false;
        continue;
      }
      const result = await InventoryService.deductReplacementInventory({
        shopify: this.shopify,
        exchangeRequestId,
        inventoryItemId: info.inventoryItemId,
        locationId,
        variantId: item.replacementVariantId,
        quantity: item.replacementQuantity,
        bostaTrackingNumber: trackingNumber,
      });
      if (!result.success) allOk = false;
    }
    return allOk;
  }

  /**
   * Admin resolution of BOSTA_CREATION_AMBIGUOUS (no Bosta-side search exists).
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
          auditLogs: { create: { action: "AMBIGUOUS_RESOLVED_SHIPMENT_EXISTS", actorType: "ADMIN" } },
        },
      });

      const deducted = await this.deductAllItems(
        exchangeRequestId,
        request.items,
        context.inventoryLocationId,
        resolution.bostaTrackingNumber
      );

      const updated = await prisma.exchangeRequest.update({
        where: { id: exchangeRequestId },
        data: deducted
          ? { status: "REPLACEMENT_INVENTORY_DEDUCTED", inventoryStatus: "DEDUCTED" }
          : { status: "INVENTORY_SYNC_FAILED", inventoryStatus: "SYNC_FAILED" },
      });

      void sendExchangeApproved({
        customerEmail: request.customerEmail,
        customerName: request.customerName,
        orderName: request.shopifyOrderName,
        trackingNumber: resolution.bostaTrackingNumber,
      });
      return updated;
    }

    // Nothing exists in Bosta: back to "pending approval" so it can be approved again.
    return prisma.exchangeRequest.update({
      where: { id: exchangeRequestId },
      data: {
        status: "REQUESTED",
        auditLogs: { create: { action: "AMBIGUOUS_RESOLVED_NOT_CREATED", actorType: "ADMIN" } },
      },
    });
  }

  /** Admin retry of ONLY the stock deduction (never re-creates a shipment). */
  async retryInventorySync(exchangeRequestId: string, inventoryLocationId: string) {
    const request = await prisma.exchangeRequest.findUniqueOrThrow({
      where: { id: exchangeRequestId },
      include: { items: true },
    });

    if (request.status !== "INVENTORY_SYNC_FAILED") {
      throw new Error("Request is not in INVENTORY_SYNC_FAILED state.");
    }

    // Skip items that were already deducted before a partial failure.
    const done = await prisma.inventoryTransaction.findMany({
      where: { exchangeRequestId },
      select: { shopifyVariantId: true },
    });
    const doneIds = new Set(done.map((d) => d.shopifyVariantId));
    const todo = request.items.filter((i) => !doneIds.has(i.replacementVariantId));

    const ok = await this.deductAllItems(
      exchangeRequestId,
      todo,
      inventoryLocationId,
      request.bostaTrackingNumber ?? ""
    );
    if (!ok) throw new Error("Inventory sync retry failed again; escalate to engineering.");

    return prisma.exchangeRequest.update({
      where: { id: exchangeRequestId },
      data: { status: "REPLACEMENT_INVENTORY_DEDUCTED", inventoryStatus: "DEDUCTED" },
    });
  }
}
