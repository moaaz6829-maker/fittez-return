import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { getShopifyServiceForRequest } from "../lib/shopifyContext";
import { phoneNumbersMatch } from "../utils/phone";
import { PricingService } from "../services/PricingService";
import rateLimit from "./rateLimit";
import { bostaTrackingUrl } from "../services/BostaService";

const router = Router();

/**
 * GET /api/catalog/search?q=...
 * Customer-facing product search used by the exchange page to let a
 * customer pick a DIFFERENT product as the replacement. Read-only.
 */
router.get("/search", rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";

  try {
    const shopify = getShopifyServiceForRequest(req);
    const results = await shopify.searchProducts(q);
    return res.json(results);
  } catch (err) {
    req.log?.error({ err }, "catalog_search_failed");
    return res.status(500).json({ error: "Something went wrong. Please try again or contact FITTEZ." });
  }
});

const quoteSchema = z.object({
  orderNumber: z.string().min(1),
  phone: z.string().min(6),
  items: z
    .array(
      z.object({
        originalLineItemId: z.string(),
        originalQuantity: z.number().int().min(1),
        replacementVariantId: z.string(),
        replacementQuantity: z.number().int().min(1),
      })
    )
    .min(1),
});

/**
 * POST /api/catalog/exchange-quote
 * Read-only price preview for the exchange page. Uses exactly the same
 * pricing code as the real exchange creation (PricingService), with prices
 * taken from Shopify and the fee from the order's governorate, so the
 * numbers shown to the customer match what is charged. It never trusts any
 * price sent by the browser and creates nothing.
 */
router.post("/exchange-quote", rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  const parsed = quoteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request." });
  const input = parsed.data;

  try {
    const shopify = getShopifyServiceForRequest(req);
    const order = await shopify.getOrderByName(input.orderNumber);

    if (!order || !order.customerPhoneE164 || !phoneNumbersMatch(order.customerPhoneE164, input.phone)) {
      return res
        .status(404)
        .json({ error: "We couldn't find this order. Please check your order number and phone number." });
    }

    const settings = await prisma.settings.findUnique({ where: { storeId: req.storeId! } });
    if (!settings?.inventoryLocationId) {
      return res.status(500).json({ error: "Something went wrong. Please try again or contact FITTEZ." });
    }

    let returnedTotal = 0;
    let replacementTotal = 0;

    for (const item of input.items) {
      const line = order.lineItems.find((l) => l.lineItemId === item.originalLineItemId);
      if (!line || item.originalQuantity > line.quantity) {
        return res.status(422).json({ error: "One of the selected items isn't part of this order." });
      }
      returnedTotal += line.price * item.originalQuantity;

      const variant = await shopify.getSingleVariantAvailability(
        item.replacementVariantId,
        settings.inventoryLocationId
      );
      if (!variant) {
        return res.status(422).json({ error: "The selected replacement isn't available." });
      }
      replacementTotal += variant.price * item.replacementQuantity;
    }

    const calc = await PricingService.computeExchange({
      storeId: req.storeId!,
      governorateName: order.shippingAddress?.province ?? "",
      returnedTotalEgp: returnedTotal,
      replacementTotalEgp: replacementTotal,
    });

    return res.json(calc);
  } catch (err) {
    req.log?.error({ err }, "exchange_quote_failed");
    return res.status(422).json({
      error: "We couldn't calculate the price for this exchange. Please contact FITTEZ.",
    });
  }
});

const myRequestSchema = z.object({ orderNumber: z.string().min(1), phone: z.string().min(6) });

const OPEN_EXCHANGE = [
  "REQUESTED", "ELIGIBILITY_CHECKED", "CREATING_BOSTA_EXCHANGE", "BOSTA_EXCHANGE_CREATED",
  "BOSTA_CREATION_AMBIGUOUS", "REPLACEMENT_INVENTORY_DEDUCTED", "REPLACEMENT_SHIPPED",
  "RETURN_IN_PROGRESS", "INVENTORY_SYNC_FAILED",
] as const;
const OPEN_REFUND = ["PENDING", "APPROVED", "REFUNDED"] as const;

/**
 * POST /api/catalog/my-request  { orderNumber, phone }
 * Tells the customer page whether this order already has an open
 * refund/exchange request (so it can show "we're already working on it" plus a
 * progress view instead of letting them submit another one). Only returns data
 * after the order number + phone are verified.
 */
router.post("/my-request", rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  const parsed = myRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request." });

  try {
    const shopify = getShopifyServiceForRequest(req);
    const order = await shopify.getOrderByName(parsed.data.orderNumber);
    if (!order || !order.customerPhoneE164 || !phoneNumbersMatch(order.customerPhoneE164, parsed.data.phone)) {
      return res.status(404).json({ error: "We couldn't find this order." });
    }

    const exchange = await prisma.exchangeRequest.findFirst({
      where: { shopifyOrderId: order.orderId, status: { in: [...OPEN_EXCHANGE] as any } },
      orderBy: { createdAt: "desc" },
    });
    if (exchange) {
      const s = exchange.status as string;
      const stage = s === "REQUESTED" || s === "ELIGIBILITY_CHECKED" ? 1 : s === "REPLACEMENT_SHIPPED" || s === "RETURN_IN_PROGRESS" ? 3 : 2;
      return res.json({
        open: true,
        type: "exchange",
        id: exchange.id,
        stage,
        tracking: exchange.bostaTrackingNumber,
        trackingUrl: exchange.bostaTrackingNumber ? bostaTrackingUrl(exchange.bostaTrackingNumber) : null,
      });
    }

    const refund = await prisma.refundRequest.findFirst({
      where: { shopifyOrderId: order.orderId, status: { in: [...OPEN_REFUND] as any } },
      orderBy: { createdAt: "desc" },
    });
    if (refund) {
      const stage = refund.status === "PENDING" ? 1 : refund.status === "APPROVED" ? 2 : 3;
      return res.json({ open: true, type: "refund", id: refund.id, stage, tracking: null, trackingUrl: null });
    }

    return res.json({ open: false });
  } catch (err) {
    req.log?.error({ err }, "my_request_lookup_failed");
    return res.json({ open: false });
  }
});

export default router;
