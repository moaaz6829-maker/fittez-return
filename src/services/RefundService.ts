import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { EligibilityService } from "./EligibilityService";
import { InventoryService } from "./InventoryService";
import { PricingService } from "./PricingService";
import { ShopifyOrderDetails } from "./ShopifyService";

export interface CreateRefundInput {
  storeId: string;
  order: ShopifyOrderDetails;
  testModeEnabled: boolean;
  refundFeeEgp: number;
  idempotencyKey: string;
  reason: "WRONG_SIZE" | "DOESNT_FIT" | "CHANGED_MIND" | "NOT_AS_EXPECTED" | "OTHER";
  otherReason?: string;
  refundMethod: "E_WALLET" | "INSTAPAY";
  refundMobile: string;
  items: Array<{ lineItemId: string; quantity: number }>;
}

export class RefundServiceError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

const OPEN_REFUND = ["PENDING", "APPROVED", "REFUNDED"];
const OPEN_EXCHANGE = [
  "REQUESTED", "ELIGIBILITY_CHECKED", "CREATING_BOSTA_EXCHANGE", "BOSTA_EXCHANGE_CREATED",
  "BOSTA_CREATION_AMBIGUOUS", "REPLACEMENT_INVENTORY_DEDUCTED", "REPLACEMENT_SHIPPED",
  "RETURN_IN_PROGRESS", "INVENTORY_SYNC_FAILED",
];

export class RefundService {
  static async createRefundRequest(input: CreateRefundInput) {
    // Idempotency: double submits must not create duplicates.
    const existing = await prisma.refundRequest.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing;

    // Eligibility: 3 days counted from the DELIVERY date (Test Mode bypasses only this).
    const eligibility = EligibilityService.checkDeliveryEligibility(
      input.order.fulfillment?.deliveredAt ?? null,
      new Date(),
      input.testModeEnabled
    );
    if (!eligibility.eligible) {
      throw new RefundServiceError(
        eligibility.reason === "NOT_DELIVERED"
          ? "This order is not eligible yet because it has not been delivered."
          : "This order is no longer eligible for refund or exchange.",
        eligibility.reason ?? "NOT_ELIGIBLE"
      );
    }

    // One open request per order (server-side guard against duplicates).
    const [openRefund, openExchange] = await Promise.all([
      prisma.refundRequest.findFirst({
        where: { shopifyOrderId: input.order.orderId, status: { in: OPEN_REFUND as any } },
      }),
      prisma.exchangeRequest.findFirst({
        where: { shopifyOrderId: input.order.orderId, status: { in: OPEN_EXCHANGE as any } },
      }),
    ]);
    if (openRefund || openExchange) {
      throw new RefundServiceError("We're already working on a request for this order.", "ALREADY_OPEN");
    }

    if (input.reason === "OTHER" && !input.otherReason) {
      throw new RefundServiceError("Please describe your reason.", "OTHER_REASON_REQUIRED");
    }

    let productValueEgp = 0;
    const itemRows: Array<{
      shopifyProductId: string;
      shopifyVariantId: string;
      lineItemId: string;
      productTitle: string;
      variantTitle: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
    }> = [];

    for (const requested of input.items) {
      const lineItem = input.order.lineItems.find((li) => li.lineItemId === requested.lineItemId);
      if (!lineItem) {
        throw new RefundServiceError("Invalid item selection.", "INVALID_LINE_ITEM");
      }

      if (EligibilityService.isSaleItem(lineItem.compareAtPrice)) {
        throw new RefundServiceError(
          "This item is on sale and is not eligible for refund or exchange",
          "SALE_ITEM_NOT_ELIGIBLE"
        );
      }

      const remaining = await InventoryService.getRemainingEligibleQuantity(
        lineItem.lineItemId,
        lineItem.quantity
      );
      if (requested.quantity < 1 || requested.quantity > remaining) {
        throw new RefundServiceError(
          "The requested quantity is no longer available for refund.",
          "QUANTITY_UNAVAILABLE"
        );
      }

      const lineTotal = lineItem.price * requested.quantity;
      productValueEgp += lineTotal;

      itemRows.push({
        shopifyProductId: lineItem.productId,
        shopifyVariantId: lineItem.variantId,
        lineItemId: lineItem.lineItemId,
        productTitle: lineItem.productTitle,
        variantTitle: lineItem.variantTitle,
        quantity: requested.quantity,
        unitPrice: lineItem.price,
        lineTotal,
      });
    }

    if (itemRows.length === 0) {
      throw new RefundServiceError("No items selected.", "NO_ITEMS");
    }

    // Backend recalculates: final = product value - return fee (once per request).
    const { subtotal, refundFee, finalRefundAmount } = PricingService.computeRefund(
      productValueEgp,
      input.refundFeeEgp
    );

    // Never create a refund of zero or less (value not above the return fee).
    if (finalRefundAmount <= 0) {
      throw new RefundServiceError(
        "The value of the selected items is not higher than the return fee, so a refund isn't possible. You can choose an exchange instead.",
        "VALUE_BELOW_FEE"
      );
    }

    const created = await prisma.refundRequest.create({
      data: {
        storeId: input.storeId,
        shopifyOrderId: input.order.orderId,
        shopifyOrderName: input.order.orderName,
        customerId: input.order.customerId,
        customerName: input.order.customerName,
        customerPhone: input.order.customerPhoneE164 ?? "",
        customerEmail: input.order.customerEmail,
        reason: input.reason,
        otherReason: input.otherReason,
        refundMethod: input.refundMethod,
        refundMobile: input.refundMobile,
        subtotal,
        refundFee,
        finalRefundAmount,
        status: "PENDING",
        idempotencyKey: input.idempotencyKey,
        items: { create: itemRows },
        auditLogs: {
          create: {
            action: "REFUND_REQUESTED",
            actorType: "CUSTOMER",
            metadata: { orderId: input.order.orderId },
          },
        },
      },
      include: { items: true },
    });

    logger.info({ refundRequestId: created.id }, "refund_request_created");
    return created;
  }
}
