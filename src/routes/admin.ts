import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { getShopifyServiceForRequest, getBostaService } from "../lib/shopifyContext";
import { ExchangeService } from "../services/ExchangeService";
import { requireAdmin } from "../middleware/requireAdmin";

const router = Router();

// All admin routes require an authenticated Shopify Embedded App admin
// session (Section 6/39: "Only Admin users can enable/disable Test Mode").
router.use(requireAdmin);

/** GET /api/admin/settings */
router.get("/settings", async (req, res) => {
  const settings = await prisma.settings.findUniqueOrThrow({ where: { storeId: req.storeId! } });
  // Never return the Bosta API key itself (it isn't stored in this table;
  // it lives only in server env / secret manager).
  return res.json(settings);
});

const updateSettingsSchema = z.object({
  refundFeeEgp: z.number().positive().optional(),
  inventoryLocationId: z.string().optional(),
  bostaBusinessLocationId: z.string().optional(),
  inventoryLockLeaseMs: z.number().int().positive().optional(),
  bostaWebhookHeaderName: z.string().min(1).optional(),
});

/** PATCH /api/admin/settings */
router.patch("/settings", async (req, res) => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid settings payload." });

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
});

/** POST /api/admin/test-mode  { enabled: boolean } -- Section 6/42/34 */
router.post("/test-mode", async (req, res) => {
  const enabled = Boolean(req.body?.enabled);

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
});

/** POST /api/admin/bosta/test-connection -- Section 43, must NOT create a shipment. */
router.post("/bosta/test-connection", async (_req, res) => {
  const bosta = getBostaService();
  const result = await bosta.testConnection();
  return res.json(result);
});

/** GET /api/admin/refunds -- dashboard list */
router.get("/refunds", async (req, res) => {
  const refunds = await prisma.refundRequest.findMany({
    where: { storeId: req.storeId! },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return res.json(refunds);
});

const refundActionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "MARK_REFUNDED", "MARK_COMPLETED"]),
  notes: z.string().max(1000).optional(),
});

/** POST /api/admin/refunds/:id/action */
router.post("/refunds/:id/action", async (req, res) => {
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
});

/** GET /api/admin/exchanges -- dashboard list */
router.get("/exchanges", async (req, res) => {
  const exchanges = await prisma.exchangeRequest.findMany({
    where: { storeId: req.storeId! },
    include: { items: true, bostaShipments: { include: { webhookEvents: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return res.json(exchanges);
});

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
router.post("/exchanges/:id/resolve-ambiguous", async (req, res) => {
  const parsed = resolveAmbiguousSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid resolution payload." });

  const settings = await prisma.settings.findUniqueOrThrow({ where: { storeId: req.storeId! } });
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
});

/** POST /api/admin/inventory/retry  { exchangeRequestId } -- Section 39/30 */
router.post("/inventory/retry", async (req, res) => {
  const exchangeRequestId = req.body?.exchangeRequestId as string | undefined;
  if (!exchangeRequestId) return res.status(400).json({ error: "exchangeRequestId is required." });

  const settings = await prisma.settings.findUniqueOrThrow({ where: { storeId: req.storeId! } });
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
});

export default router;
