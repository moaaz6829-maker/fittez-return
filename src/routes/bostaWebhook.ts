import { Router } from "express";
import { prisma } from "../lib/db";
import { isAllowedBostaSourceIp, verifyWebhookSharedSecret } from "../services/BostaService";
import { WebhookService } from "../services/WebhookService";

const router = Router();

/**
 * POST /api/bosta/webhook
 *
 * Verified trust model per docs.bosta.co/docs/how-to/whitelisting and
 * .../get-delivery-status-via-webhook -- Bosta documents NO cryptographic
 * signature scheme. The two documented mechanisms are applied here:
 *
 *   1. Source IP allowlist (34.89.199.241 / 35.246.223.19). This is only
 *      meaningful if the deployment's `req.ip` reliably reflects the real
 *      client IP (e.g. `app.set('trust proxy', ...)` configured correctly
 *      for your load balancer). Logged but treated as advisory alongside
 *      mechanism #2, since IP spoofing/proxy misconfiguration is possible.
 *   2. A static shared-secret header, whose NAME is configurable per
 *      Settings.bostaWebhookHeaderName and whose VALUE lives only in
 *      BOSTA_WEBHOOK_SECRET (env), compared in constant time. This is a
 *      shared-secret check, not a signature -- there is nothing to verify
 *      cryptographically per Bosta's own docs.
 *
 * Both are checked; the secret check is authoritative (request is
 * rejected if it fails), the IP check is logged for visibility but does
 * not by itself reject a request whose secret is correct, since some
 * legitimate deployments cannot see Bosta's true source IP through a
 * proxy layer.
 */
router.post("/webhook", async (req, res) => {
  const settings = await prisma.settings.findFirst();
  const headerName = settings?.bostaWebhookHeaderName ?? "X-Fittez-Webhook-Secret";
  const configuredSecret = process.env.BOSTA_WEBHOOK_SECRET ?? "";

  const receivedSecret = req.header(headerName);
  const secretOk = verifyWebhookSharedSecret(
    Array.isArray(receivedSecret) ? receivedSecret[0] : receivedSecret,
    configuredSecret
  );

  const sourceIpOk = isAllowedBostaSourceIp(req.ip);
  if (!sourceIpOk) {
    req.log?.warn({ ip: req.ip }, "bosta_webhook_source_ip_not_in_allowlist");
  }

  if (!secretOk) {
    // Authoritative rejection. Never log the secret itself or the
    // received value.
    return res.status(401).json({ error: "Invalid webhook credentials." });
  }

  const body = req.body as any;

  // VERIFIED field names per docs.bosta.co webhook payload documentation.
  const trackingNumber: string | undefined = body?.trackingNumber?.toString();
  const state: number | undefined = typeof body?.state === "number" ? body.state : undefined;
  const type: string | undefined = body?.type;
  const timeStamp: number | undefined = typeof body?.timeStamp === "number" ? body.timeStamp : undefined;
  const businessReference: string | undefined = body?.businessReference;

  if (!trackingNumber || state === undefined || !type || timeStamp === undefined) {
    return res.status(400).json({ error: "Missing required webhook fields." });
  }

  try {
    await WebhookService.processBostaWebhook({
      trackingNumber,
      state,
      type,
      timeStamp,
      businessReference,
      raw: body,
    });
    return res.status(200).json({ received: true });
  } catch (err) {
    req.log?.error({ err }, "bosta_webhook_processing_failed");
    // Bosta will retry on non-2xx; our processing is idempotent (keyed by
    // trackingNumber+state+timeStamp), so it's safe to ask for a retry.
    return res.status(500).json({ error: "Processing failed, will retry." });
  }
});

export default router;
