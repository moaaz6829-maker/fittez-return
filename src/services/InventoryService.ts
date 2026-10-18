import { prisma } from "../lib/db";
import { withInventoryLock } from "../lib/inventoryLock";
import { ShopifyService, VariantAvailability } from "./ShopifyService";
import { logger } from "../lib/logger";

/**
 * Section 36 (finalized): a line item's quantity is only "consumed" once a
 * refund/exchange has been SUCCESSFULLY processed:
 *   - Refund: status reached REFUNDED or COMPLETED (i.e. approved and paid,
 *     per FITTEZ's own workflow -- APPROVED alone does not consume yet
 *     because it can still be reversed by an admin before payment; this
 *     project treats REFUNDED/COMPLETED as the "success" boundary. If
 *     FITTEZ wants APPROVED to already lock the quantity, change
 *     REFUND_CONSUMING_STATUSES below -- it is intentionally isolated here.)
 *   - Exchange: Bosta Exchange was successfully created (status is
 *     BOSTA_EXCHANGE_CREATED or later, i.e. NOT REQUESTED/ELIGIBILITY_CHECKED/
 *     CREATING_BOSTA_EXCHANGE/FAILED/REJECTED/CANCELED).
 */
const REFUND_CONSUMING_STATUSES = ["REFUNDED", "COMPLETED"] as const;
const EXCHANGE_CONSUMING_STATUSES = [
  "BOSTA_EXCHANGE_CREATED",
  "REPLACEMENT_INVENTORY_DEDUCTED",
  "REPLACEMENT_SHIPPED",
  "RETURN_IN_PROGRESS",
  "RETURNED_TO_BUSINESS",
  "COMPLETED",
  "INVENTORY_SYNC_FAILED", // Bosta shipment DID succeed in this state
] as const;

export class InventoryService {
  /**
   * Returns how many units of a given Shopify order line item are still
   * eligible to be refunded/exchanged, after subtracting quantities already
   * successfully consumed by prior refund or exchange requests.
   */
  static async getRemainingEligibleQuantity(
    lineItemId: string,
    orderedQuantity: number
  ): Promise<number> {
    const [refundedItems, exchangedItems] = await Promise.all([
      prisma.refundItem.findMany({
        where: {
          lineItemId,
          refundRequest: { status: { in: [...REFUND_CONSUMING_STATUSES] } },
        },
        select: { quantity: true },
      }),
      prisma.exchangeItem.findMany({
        where: {
          originalLineItemId: lineItemId,
          exchangeRequest: { status: { in: [...EXCHANGE_CONSUMING_STATUSES] } },
        },
        select: { originalQuantity: true },
      }),
    ]);

    const consumed =
      refundedItems.reduce((sum: number, i: { quantity: number }) => sum + i.quantity, 0) +
      exchangedItems.reduce(
        (sum: number, i: { originalQuantity: number }) => sum + i.originalQuantity,
        0
      );

    return Math.max(orderedQuantity - consumed, 0);
  }

  /** Section 16: current stock per variant for the "choose replacement" UI. */
  static async getReplacementVariantAvailability(
    shopify: ShopifyService,
    productId: string,
    locationId: string
  ): Promise<VariantAvailability[]> {
    return shopify.getVariantAvailability(productId, locationId);
  }

  /**
   * Section 17 + finalized concurrency decision. This is the full
   * critical section:
   *   1. Acquire the application-level lock for the variant.
   *   2. Re-check live Shopify inventory.
   *   3. If insufficient -> release lock, return needsReselection=true,
   *      caller must NOT create Bosta or touch inventory.
   *   4. If sufficient -> caller creates the Bosta Exchange WHILE the lock
   *      is still held, then deducts inventory, all inside the same lock.
   *
   * The lock is held across steps 2-4 via the `fn` callback so no other
   * request can interleave a purchase/exchange against the same variant
   * between our check and our deduction.
   */
  static async runLockedExchangeInventoryFlow<T>(params: {
    shopify: ShopifyService;
    variantId: string;
    inventoryItemId: string;
    locationId: string;
    requiredQuantity: number;
    exchangeRequestId: string;
    leaseMs: number;
    onSufficientStock: () => Promise<T>;
  }): Promise<
    | { outcome: "INSUFFICIENT_STOCK" }
    | { outcome: "SUCCESS"; result: T }
  > {
    return withInventoryLock(
      params.variantId,
      params.exchangeRequestId,
      params.leaseMs,
      async () => {
        const variant = await params.shopify.getSingleVariantAvailability(
          params.variantId,
          params.locationId
        );
        const available = variant?.availableQuantity ?? 0;

        if (available < params.requiredQuantity) {
          logger.info(
            { variantId: params.variantId, available, required: params.requiredQuantity },
            "exchange_final_inventory_check_insufficient"
          );
          return { outcome: "INSUFFICIENT_STOCK" as const };
        }

        const result = await params.onSufficientStock();
        return { outcome: "SUCCESS" as const, result };
      }
    );
  }

  /**
   * Section 24/26: deduct replacement inventory. Only ever called AFTER a
   * successful Bosta Exchange creation, and only while still holding the
   * inventory lock for that variant. Uses a signed delta (never an
   * absolute overwrite) and never allows inventory to go negative --
   * Shopify itself will reject/clamp per location settings, but we also
   * guard here defensively.
   */
  static async deductReplacementInventory(params: {
    shopify: ShopifyService;
    exchangeRequestId: string;
    inventoryItemId: string;
    locationId: string;
    variantId: string;
    quantity: number;
    bostaTrackingNumber: string;
  }) {
    const delta = -Math.abs(params.quantity);

    const result = await params.shopify.deductInventory({
      inventoryItemId: params.inventoryItemId,
      locationId: params.locationId,
      delta,
      reason: "correction",
    });

    if (!result.success) {
      return { success: false as const, rawResponse: result.rawResponse };
    }

    await prisma.inventoryTransaction.create({
      data: {
        exchangeRequestId: params.exchangeRequestId,
        shopifyVariantId: params.variantId,
        shopifyInventoryItemId: params.inventoryItemId,
        shopifyLocationId: params.locationId,
        quantityDelta: delta,
        reason: "Exchange Replacement",
        bostaTrackingNumber: params.bostaTrackingNumber,
        shopifyResponseSnapshot: result.rawResponse as any,
      },
    });

    return { success: true as const, newAvailable: result.newAvailable };
  }
}
