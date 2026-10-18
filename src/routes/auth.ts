import { Router, Request } from "express";
import crypto from "crypto";
import axios from "axios";
import { prisma } from "../lib/db";
import { logger } from "../lib/logger";

/**
 * Real Shopify OAuth install flow.
 *
 * Why this exists: FITTEZ's app was created after Shopify stopped issuing
 * new admin-created "Custom Apps" with a static Admin API access token
 * (blocked platform-wide as of Jan 1, 2026 -- confirmed directly in the
 * Shopify Admin "Develop apps" screen: "As of January 1, 2026, you can no
 * longer create new legacy custom apps"). Every new app -- even a private,
 * single-store one -- now goes through the standard OAuth authorization
 * code grant. There is no static token to copy/paste anymore; this route
 * pair performs the OAuth handshake once and stores the resulting access
 * token in our own Store table.
 *
 * Implemented directly against Shopify's documented OAuth endpoints
 * (shopify.dev/docs/apps/auth/oauth/getting-started) rather than relying on
 * the shopify-api library's auth.begin()/auth.callback() helpers, which
 * expect a configured SessionStorage adapter we don't otherwise use (FITTEZ
 * persists exactly one Store row per shop in Prisma, not a general Shopify
 * session store). No undocumented fields/endpoints are used here.
 *
 * Flow:
 *   GET /auth?shop=xxx.myshopify.com
 *     -> redirects the merchant to Shopify's authorization screen.
 *   GET /auth/callback?shop=...&code=...&state=...&hmac=...
 *     -> verifies the callback is genuinely from Shopify (HMAC + state),
 *        exchanges the one-time `code` for a permanent access token,
 *        upserts Store.accessToken, and redirects into the embedded /admin.
 */

const router = Router();

const OAUTH_STATE_COOKIE = "fittez_oauth_state";

function isValidShopDomain(shop: string): boolean {
  // VERIFIED shape per Shopify's own validation guidance: lowercase letters,
  // numbers and hyphens, ending in .myshopify.com.
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

/**
 * Verifies the HMAC Shopify attaches to OAuth redirect/callback query
 * strings. Documented algorithm: sort all query params except `hmac` and
 * `signature`, join as `key=value` pairs with `&`, HMAC-SHA256 with the
 * app's client secret, compare hex digest using constant-time comparison.
 */
function verifyOAuthHmac(query: Request["query"], secret: string): boolean {
  const hmac = query.hmac;
  if (typeof hmac !== "string") return false;

  const message = Object.keys(query)
    .filter((key) => key !== "hmac" && key !== "signature")
    .sort()
    .map((key) => {
      const value = query[key];
      const stringValue = Array.isArray(value) ? value.join(",") : String(value);
      return `${key}=${stringValue}`;
    })
    .join("&");

  const generated = crypto.createHmac("sha256", secret).update(message).digest("hex");

  const a = Buffer.from(generated, "utf8");
  const b = Buffer.from(hmac, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

router.get("/", (req, res) => {
  const { shop } = req.query;

  if (typeof shop !== "string" || !isValidShopDomain(shop)) {
    res.status(400).send("Missing or invalid shop parameter.");
    return;
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  const scopes = process.env.SHOPIFY_SCOPES;
  const appUrl = process.env.SHOPIFY_APP_URL;

  if (!apiKey || !scopes || !appUrl) {
    logger.error("shopify_oauth_missing_server_config");
    res.status(500).send("Server is not configured for installation. Contact FITTEZ.");
    return;
  }

  const state = crypto.randomBytes(16).toString("hex");

  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 5 * 60 * 1000, // 5 minutes -- just long enough to complete the redirect round-trip
  });

  const redirectUri = `${appUrl.replace(/\/+$/, "")}/auth/callback`;

  const authorizeUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(apiKey)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  res.redirect(authorizeUrl);
});

router.get("/callback", async (req, res) => {
  try {
    const { shop, code, state, hmac, host } = req.query;

    if (
      typeof shop !== "string" ||
      typeof code !== "string" ||
      typeof state !== "string" ||
      typeof hmac !== "string" ||
      !isValidShopDomain(shop)
    ) {
      res.status(400).send("Invalid installation callback.");
      return;
    }

    const expectedState = req.cookies?.[OAUTH_STATE_COOKIE];
    if (!expectedState || expectedState !== state) {
      res.status(403).send("Invalid or expired installation attempt. Please start installation again.");
      return;
    }

    const apiSecret = process.env.SHOPIFY_API_SECRET;
    const apiKey = process.env.SHOPIFY_API_KEY;
    if (!apiSecret || !apiKey) {
      logger.error("shopify_oauth_missing_server_config");
      res.status(500).send("Server is not configured for installation. Contact FITTEZ.");
      return;
    }

    if (!verifyOAuthHmac(req.query, apiSecret)) {
      logger.warn("shopify_oauth_hmac_verification_failed");
      res.status(403).send("Invalid request signature.");
      return;
    }

    // VERIFIED documented token exchange endpoint.
    const tokenResponse = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: apiKey,
      client_secret: apiSecret,
      code,
    });

    const accessToken = tokenResponse.data?.access_token;
    if (typeof accessToken !== "string" || !accessToken) {
      throw new Error("Shopify did not return an access token.");
    }

    await prisma.store.upsert({
      where: { shopDomain: shop },
      update: { accessToken, isActive: true },
      create: { shopDomain: shop, accessToken, isActive: true },
    });

    res.clearCookie(OAUTH_STATE_COOKIE);

    const redirectTarget =
      typeof host === "string"
        ? `/admin?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`
        : `/admin?shop=${encodeURIComponent(shop)}`;

    res.redirect(redirectTarget);
  } catch (err) {
    logger.error({ err }, "shopify_oauth_callback_failed");
    res.status(500).send("Installation failed. Please try again or contact FITTEZ.");
  }
});

export default router;
