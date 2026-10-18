import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { getShopifyServiceForRequest } from "../lib/shopifyContext";
import { phoneNumbersMatch } from "../utils/phone";
import { RefundService, RefundServiceError } from "../services/RefundService";
import rateLimit from "./rateLimit";

const router = Router();

const createRefundSchema = z.object({
  orderNumber: z.string().min(1),
  phone: z.string().min(6),
  idempotencyKey: z.string().uuid(),
  reason: z.enum(["WRONG_SIZE", "DOESNT_FIT", "CHANGED_MIND", "NOT_AS_EXPECTED", "OTHER"]),
  otherReason: z.string().max(500).optional(),
  refundMethod: z.enum(["E_WALLET", "INSTAPAY"]),
  refundMobile: z.string().min(6),
  items: z
    .array(z.object({ lineItemId: z.string(), quantity: z.number().int().min(1) }))
    .min(1),
});

/**
 * POST /api/refunds/create
 * Re-verifies order + phone server-side again (never trusts a prior
 * /orders/verify call as sufficient authorization for this write).
 */
router.post("/create", rateLimit({ windowMs: 60_000, max: 5 }), async (req, res) => {
  const parsed = createRefundSchema.safeParse(req.body);
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

    const refund = await RefundService.createRefundRequest({
      storeId: req.storeId!,
      order,
      testModeEnabled: settings.testModeEnabled,
      refundFeeEgp: Number(settings.refundFeeEgp),
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      otherReason: input.otherReason,
      refundMethod: input.refundMethod,
      refundMobile: input.refundMobile,
      items: input.items,
    });

    return res.status(201).json(refund);
  } catch (err) {
    if (err instanceof RefundServiceError) {
      return res.status(422).json({ error: err.message, code: err.code });
    }
    req.log?.error({ err }, "refund_create_failed");
    return res.status(500).json({ error: "Something went wrong. Please try again or contact FITTEZ." });
  }
});

/** GET /api/refunds/:id -- customer-facing status lookup. */
router.get("/:id", async (req, res) => {
  const refund = await prisma.refundRequest.findUnique({
    where: { id: req.params.id },
    include: { items: true },
  });
  if (!refund || refund.storeId !== req.storeId) {
    return res.status(404).json({ error: "Not found." });
  }
  return res.json(refund);
});

export default router;
