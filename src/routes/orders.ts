import { Router } from "express";
import { z } from "zod";
import rateLimit from "./rateLimit";
import { phoneNumbersMatch } from "../utils/phone";
import { EligibilityService } from "../services/EligibilityService";
import { prisma } from "../lib/db";
import { getShopifyServiceForRequest } from "../lib/shopifyContext";

const router = Router();

const verifySchema = z.object({
  orderNumber: z.string().min(1).max(20),
  phone: z.string().min(6).max(30),
});

/**
 * POST /api/orders/verify
 * Section 3: verifies order number + phone together. Section 39: rate
 * limited and does not allow order enumeration (generic error message,
 * no distinction between "order not found" and "phone mismatch").
 */
router.post("/verify", rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Please enter a valid order number and phone number." });
  }

  const { orderNumber, phone } = parsed.data;
  const shopify = getShopifyServiceForRequest(req);
  const settings = await prisma.settings.findUniqueOrThrow({
    where: { storeId: req.storeId! },
  });

  try {
    const order = await shopify.getOrderByName(orderNumber);

    const genericInvalid = () =>
      res
        .status(404)
        .json({ error: "We couldn't find this order. Please check your order number and phone number." });

    if (!order || !order.customerPhoneE164) return genericInvalid();
    if (!phoneNumbersMatch(order.customerPhoneE164, phone)) return genericInvalid();

    const eligibility = EligibilityService.checkDeliveryEligibility(
      order.fulfillment?.deliveredAt ?? null,
      new Date(),
      settings.testModeEnabled
    );

    // Only expose eligible, non-sale line items -- Section 3 "do not expose
    // unnecessary customer information".
    const eligibleItems = order.lineItems
      .filter((li) => !EligibilityService.isSaleItem(li.compareAtPrice))
      .map((li) => ({
        lineItemId: li.lineItemId,
        productId: li.productId,
        variantId: li.variantId,
        productTitle: li.productTitle,
        variantTitle: li.variantTitle,
        quantity: li.quantity,
        price: li.price,
      }));

    return res.json({
      orderId: order.orderId,
      orderName: order.orderName,
      eligible: eligibility.eligible,
      eligibilityReason: eligibility.reason,
      testModeActive: settings.testModeEnabled,
      items: eligibleItems,
      saleItemsExcluded: order.lineItems.some((li) => EligibilityService.isSaleItem(li.compareAtPrice)),
    });
  } catch (err) {
    req.log?.error({ err }, "order_verify_failed");
    return res.status(500).json({ error: "Something went wrong. Please try again or contact FITTEZ." });
  }
});

export default router;
