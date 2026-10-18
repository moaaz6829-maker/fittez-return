import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { getShopifyServiceForRequest, getBostaService } from "../lib/shopifyContext";
import { ExchangeService } from "../services/ExchangeService";
import { requireAdmin } from "../middleware/requireAdmin";

const router = Router();

// All admin routes require an authenticated Shopify Embedded App admin
// session (Section 6/39: "Only Admin users can enable/disable Test Mode").
router.use(requireAdmin);

/**
 * Express 4 does not catch a rejected promise thrown inside an async route
 * handler -- it becomes an unhandled rejection and crashes the whole
 * process (this is exactly what happened the first time a store had no
 * Settings row yet: `findUniqueOrThrow` rejected, nothing caught it, and
 * the Node process exited). Wrapping every async handler below in this
 * forwards any rejection to Express's error-handling middleware instead
 * (see the generic error handler in server.ts), so a bug in one request
 * returns a 500 to that one request instead of taking the server down.
 */
function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

/**
 * A store's Settings row is normally created by prisma/seed.ts. That seed
 * runs against whatever SHOPIFY_SHOP was configured at the time, so it's
 * easy for a store to end up with no Settings row yet (e.g. the shop
 * domain used during setup didn't match the real *.myshopify.com domain
 * Shopify actually sends). Rather than hard-failing every admin request
 * for that store, create the same defaults prisma/seed.ts would have, the
 * first time they're needed. Safe to call repeatedly -- a second call
 * just returns the existing row.
 */
async function getOrCreateSettings(storeId: string) {
  const existing = await prisma.settings.findUnique({ where: { storeId } });
  if (existing) return existing;

  return prisma.settings.create({
    data: { storeId },
    // All other fields use the schema's own defaults (testModeEnabled,
    // refundFeeEgp, bostaWebhookHeaderName, inventoryLockLeaseMs, etc).
  });
}

/** GET /api/admin/settings */
router.get(
  "/settings",
  asyncHandler(async (req, res) => {
    const settings = await getOrCreateSettings(req.storeId!);
    // Never return the Bosta API key itself (it isn't stored in this table;
    // it lives only in server env / secret manager).
    return res.json(settings);
  })
);

const updateSettingsSchema = z.object({
  refundFeeEgp: z.number().positive().optional(),
  inventoryLocationId: z.string().optional(),
  bostaBusinessLocationId: z.string().optional(),
  inventoryLockLeaseMs: z.number().int().positive().optional(),
  bostaWebhookHeaderName: z.string().min(1).optional(),
});

/** PATCH /api/admin/settings */
router.patch(
  "/settings",
  asyncHandler(async (req, res) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid settings payload." });

    await getOrCreateSettings(req.storeId!);

    const updated = await prisma.settings.update({
      where: { storeId: req.storeId! },
      data: parsed.data,
    });

    await prisma.adminAction.create({
      data: {
        storeId: req.storeId!,
        adminId: req.adminId!,
        action: "UPDATE_SETTINGS",
        targetType: "Settings",
        notes: JSON.stringify(parsed.data),
      },
    });

    return res.json(updated);
  })
);

/** POST /api/admin/test-mode  { enabled: boolean } -- Section 6/42/34 */
router.post(
  "/test-mode",
  asyncHandler(async (req, res) => {
    const enabled = Boolean(req.body?.enabled);

    await getOrCreateSettings(req.storeId!);

    const updated = await prisma.settings.update({
      where: { storeId: req.storeId! },
      data: { testModeEnabled: enabled },
    });

    await prisma.adminAction.create({
      data: {
        storeId: req.storeId!,
        adminId: req.adminId!,
        action: enabled ? "TEST_MODE_ENABLED" : "TEST_MODE_DISABLED",
        targetType: "Settings",
      },
    });

    return res.json(updated);
  })
);

/**
 * GET /api/admin/shipping-rates
 *
 * Lists every governorate and the exchange fee of the zone it currently
 * belongs to (Section 20: governorate -> zone -> fee mapping, seeded by
 * prisma/seed.ts). Several governorates can share one zone/fee; this
 * endpoint returns the flattened per-governorate view the dashboard
 * displays, while PATCHing a fee actually updates the shared zone (see
 * the PATCH route below).
 */
router.get(
  "/shipping-rates",
  asyncHandler(async (req, res) => {
    const rates = await prisma.shippingRate.findMany({
      where: { zone: { storeId: req.storeId! } },
      include: { zone: true },
      orderBy: { governorateName: "asc" },
    });
    return res.json(rates);
  })
);

const updateZoneFeeSchema = z.object({
  exchangeFeeEgp: z.number().positive(),
});

/**
 * PATCH /api/admin/shipping-zones/:zoneId  { exchangeFeeEgp }
 *
 * Updates a zone's exchange fee. Because governorates are grouped into
 * zones (not given a fee individually), this changes the fee for every
 * governorate currently mapped to this zone -- the dashboard surfaces
 * that explicitly rather than silently.
 */
router.patch(
  "/shipping-zones/:zoneId",
  asyncHandler(async (req, res) => {
    const parsed = updateZoneFeeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid fee." });

    const zone = await prisma.shippingZone.findUnique({ where: { id: req.params.zoneId } });
    if (!zone || zone.storeId !== req.storeId) {
      return res.status(404).json({ error: "Shipping zone not found." });
    }

    const updated = await prisma.shippingZone.update({
      where: { id: req.params.zoneId },
      data: { exchangeFeeEgp: parsed.data.exchangeFeeEgp },
    });

    await prisma.adminAction.create({
      data: {
        storeId: req.storeId!,
        adminId: req.adminId!,
        action: "UPDATE_SHIPPING_ZONE_FEE",
        targetType: "Settings",
        targetId: updated.id,
        notes: JSON.stringify(parsed.data),
      },
    });

    return res.json(updated);
  })
);

/** POST /api/admin/bosta/test-connection -- Section 43, must NOT create a shipment. */
router.post(
  "/bosta/test-connection",
  asyncHandler(async (_req, res) => {
    const bosta = getBostaService();
    const result = await bosta.testConnection();
    return res.json(result);
  })
);

/** GET /api/admin/refunds -- dashboard list */
router.get(
  "/refunds",
  asyncHandler(async (req, res) => {
    const refunds = await prisma.refundRequest.findMany({
      where: { storeId: req.storeId! },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return res.json(refunds);
  })
);

const refundActionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "MARK_REFUNDED", "MARK_COMPLETED"]),
  notes: z.string().max(1000).optional(),
});

/** POST /api/admin/refunds/:id/action */
router.post(
  "/refunds/:id/action",
  asyncHandler(async (req, res) => {
    const parsed = refundActionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid action." });

    const statusMap: Record<string, string> = {
      APPROVE: "APPROVED",
      REJECT: "REJECTED",
      MARK_REFUNDED: "REFUNDED",
      MARK_COMPLETED: "COMPLETED",
    };

    const updated = await prisma.refundRequest.update({
      where: { id: req.params.id },
      data: {
        status: statusMap[parsed.data.action] as any,
        adminNotes: parsed.data.notes,
      },
    });

    await prisma.adminAction.create({
      data: {
        storeId: req.storeId!,
        adminId: req.adminId!,
        action: parsed.data.action,
        targetType: "RefundRequest",
        targetId: updated.id,
        notes: parsed.data.notes,
      },
    });

    return res.json(updated);
  })
);

/** GET /api/admin/exchanges -- dashboard list */
router.get(
  "/exchanges",
  asyncHandler(async (req, res) => {
    const exchanges = await prisma.exchangeRequest.findMany({
      where: { storeId: req.storeId! },
      include: { items: true, bostaShipments: { include: { webhookEvents: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return res.json(exchanges);
  })
);

const resolveAmbiguousSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("SHIPMENT_EXISTS"),
    bostaShipmentId: z.string().min(1),
    bostaTrackingNumber: z.string().min(1),
  }),
  z.object({ outcome: z.literal("SHIPMENT_NOT_CREATED") }),
]);

/**
 * POST /api/admin/exchanges/:id/resolve-ambiguous
 *
 * For requests in BOSTA_CREATION_AMBIGUOUS. Per Bosta API verification,
 * there is no confirmed endpoint to search Bosta by reference, so this
 * can only be resolved by an admin manually checking the Bosta Dashboard
 * and telling FITTEZ what they found.
 */
router.post(
  "/exchanges/:id/resolve-ambiguous",
  asyncHandler(async (req, res) => {
    const parsed = resolveAmbiguousSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid resolution payload." });

    const settings = await getOrCreateSettings(req.storeId!);
    if (!settings.inventoryLocationId) {
      return res.status(500).json({ error: "Inventory location not configured." });
    }

    const shopify = getShopifyServiceForRequest(req);
    const bosta = getBostaService();
    const service = new ExchangeService(shopify, bosta);

    try {
      const result = await service.resolveAmbiguousBostaCreation(req.params.id, parsed.data, {
        shopify,
        inventoryLocationId: settings.inventoryLocationId,
        inventoryLockLeaseMs: settings.inventoryLockLeaseMs,
      });

      await prisma.adminAction.create({
        data: {
          storeId: req.storeId!,
          adminId: req.adminId!,
          action: "RESOLVE_AMBIGUOUS_BOSTA_CREATION",
          targetType: "ExchangeRequest",
          targetId: req.params.id,
          notes: JSON.stringify(parsed.data),
        },
      });

      return res.json(result);
    } catch (err) {
      return res.status(422).json({ error: (err as Error).message });
    }
  })
);

/** POST /api/admin/inventory/retry  { exchangeRequestId } -- Section 39/30 */
router.post(
  "/inventory/retry",
  asyncHandler(async (req, res) => {
    const exchangeRequestId = req.body?.exchangeRequestId as string | undefined;
    if (!exchangeRequestId) return res.status(400).json({ error: "exchangeRequestId is required." });

    const settings = await getOrCreateSettings(req.storeId!);
    if (!settings.inventoryLocationId) {
      return res.status(500).json({ error: "Inventory location not configured." });
    }

    const shopify = getShopifyServiceForRequest(req);
    const bosta = getBostaService();
    const service = new ExchangeService(shopify, bosta);

    try {
      const result = await service.retryInventorySync(exchangeRequestId, settings.inventoryLocationId);
      await prisma.adminAction.create({
        data: {
          storeId: req.storeId!,
          adminId: req.adminId!,
          action: "RETRY_INVENTORY",
          targetType: "ExchangeRequest",
          targetId: exchangeRequestId,
        },
      });
      return res.json(result);
    } catch (err) {
      return res.status(422).json({ error: (err as Error).message });
    }
  })
);

export default router;
