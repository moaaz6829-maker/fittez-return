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

export class RefundService {
  static async createRefundRequest(input: CreateRefundInput) {
    // Idempotency: Section 26/35 - double submits must not create duplicates.
    const existing = await prisma.refundRequest.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing;

    // Section 5: eligibility (Test Mode only bypasses delivered/3-day checks)
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

      // Section 7: backend independently verifies sale status.
      if (EligibilityService.isSaleItem(lineItem.compareAtPrice)) {
        throw new RefundServiceError(
          "This item is on sale and is not eligible for refund or exchange",
          "SALE_ITEM_NOT_ELIGIBLE"
        );
      }

      // Section 36/37: only remaining, not-yet-consumed quantity is refundable.
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

    // Section 12: backend recalculates the final amount; never trust a
    // frontend-submitted total.
    const { subtotal, refundFee, finalRefundAmount } = PricingService.computeRefund(
      productValueEgp,
      input.refundFeeEgp
    );

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
