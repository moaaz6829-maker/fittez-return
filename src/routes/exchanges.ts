import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { getShopifyServiceForRequest, getBostaService } from "../lib/shopifyContext";
import { phoneNumbersMatch } from "../utils/phone";
import { ExchangeService, ExchangeServiceError } from "../services/ExchangeService";
import rateLimit from "./rateLimit";

const router = Router();

const createExchangeSchema = z.object({
  orderNumber: z.string().min(1),
  phone: z.string().min(6),
  idempotencyKey: z.string().uuid(),
  items: z
    .array(
      z.object({
        originalLineItemId: z.string(),
        originalQuantity: z.number().int().min(1),
        replacementProductId: z.string(),
        replacementVariantId: z.string(),
        replacementQuantity: z.number().int().min(1),
      })
    )
    .min(1),
  refundMethod: z.enum(["E_WALLET", "INSTAPAY"]).optional(),
  refundMobile: z.string().optional(),
});

router.post("/create", rateLimit({ windowMs: 60_000, max: 5 }), async (req, res) => {
  const parsed = createExchangeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request." });
  }
  const input = parsed.data;

  try {
    const shopify = getShopifyServiceForRequest(req);
    const order = await shopify.getOrderByName(input.orderNumber);

    if (!order || !order.customerPhoneE164 || !phoneNumbersMatch(order.customerPhoneE164, input.phone)) {
      return res
        .status(404)
        .json({ error: "We couldn't find this order. Please check your order number and phone number." });
    }

    const settings = await prisma.settings.findUniqueOrThrow({ where: { storeId: req.storeId! } });
    if (!settings.inventoryLocationId) {
      return res.status(500).json({ error: "Something went wrong. Please try again or contact FITTEZ." });
    }

    const bosta = getBostaService();
    const service = new ExchangeService(shopify, bosta);

    const exchange = await service.createExchange({
      storeId: req.storeId!,
      order,
      testModeEnabled: settings.testModeEnabled,
      idempotencyKey: input.idempotencyKey,
      items: input.items,
      refundMethod: input.refundMethod,
      refundMobile: input.refundMobile,
      inventoryLocationId: settings.inventoryLocationId,
      inventoryLockLeaseMs: settings.inventoryLockLeaseMs,
    });

    return res.status(201).json(exchange);
  } catch (err) {
    if (err instanceof ExchangeServiceError) {
      return res.status(422).json({ error: err.message, code: err.code });
    }
    req.log?.error({ err }, "exchange_create_failed");
    return res.status(500).json({ error: "Something went wrong. Please try again or contact FITTEZ." });
  }
});

/** GET /api/exchanges/:id -- customer-facing tracking view (Section 32). */
router.get("/:id", async (req, res) => {
  const exchange = await prisma.exchangeRequest.findUnique({
    where: { id: req.params.id },
    include: { items: true, bostaShipments: true },
  });
  if (!exchange || exchange.storeId !== req.storeId) {
    return res.status(404).json({ error: "Not found." });
  }
  return res.json(exchange);
});

/**
 * GET /api/exchanges/replacement-availability?productId=...
 * Section 16: live per-variant stock for the replacement picker UI.
 */
router.get("/utils/replacement-availability", async (req, res) => {
  const productId = req.query.productId as string | undefined;
  if (!productId) return res.status(400).json({ error: "productId is required." });

  const settings = await prisma.settings.findUniqueOrThrow({ where: { storeId: req.storeId! } });
  if (!settings.inventoryLocationId) {
    return res.status(500).json({ error: "Inventory location not configured." });
  }

  const shopify = getShopifyServiceForRequest(req);
  const variants = await shopify.getVariantAvailability(productId, settings.inventoryLocationId);

  return res.json(
    variants.map((v) => ({
      variantId: v.variantId,
      title: v.title,
      inStock: v.availableQuantity > 0,
      isSaleItem: v.compareAtPrice !== null && v.compareAtPrice > 0,
    }))
  );
});

export default router;
