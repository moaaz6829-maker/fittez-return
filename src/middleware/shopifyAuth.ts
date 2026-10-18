import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/db";
import { shopifyApiClient } from "../lib/shopifyApiClient";

/**
 * Section 39/47: Shopify OAuth/session authentication.
 *
 * This is a structural placeholder showing exactly what the middleware
 * must guarantee before any route handler runs. For a real deployment,
 * replace the body of `loadSession` with `@shopify/shopify-api`'s session
 * loader (or the Shopify Remix/Node app template's built-in auth), which
 * validates the signed session token from the Shopify Embedded App
 * (App Bridge) on every request.
 *
 * Whatever mechanism is used, it MUST:
 *   - cryptographically verify the request actually came from Shopify /
 *     the authenticated embedded app session (never trust a client-supplied
 *     shop domain header alone),
 *   - resolve the shop's stored OAuth access token from the database,
 *   - never expose that access token to the frontend or logs.
 */
export async function shopifyCustomerFacingAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // The customer-facing (storefront) surface does not use Shopify admin
    // OAuth at all -- it runs server-side against the merchant's own
    // stored Store row, resolved by shop domain (e.g. from the app proxy
    // request Shopify signs, or a fixed single-tenant config for FITTEZ).
    const shopDomain = process.env.SHOPIFY_SHOP;
    if (!shopDomain) {
      res.status(500).json({ error: "Something went wrong. Please try again or contact FITTEZ." });
      return;
    }

    const store = await prisma.store.findUnique({ where: { shopDomain } });
    if (!store || !store.isActive) {
      res.status(500).json({ error: "Something went wrong. Please try again or contact FITTEZ." });
      return;
    }

    req.storeId = store.id;
    req.shopDomain = store.shopDomain;
    req.shopifyAccessToken = store.accessToken; // TODO: decrypt if encrypted at rest
    next();
  } catch (err) {
    req.log?.error({ err }, "shopify_customer_auth_failed");
    res.status(500).json({ error: "Something went wrong. Please try again or contact FITTEZ." });
  }
}

/**
 * Embedded Admin App session verification.
 *
 * NOTE (updated): FITTEZ's app was created after Shopify stopped issuing
 * new "Custom Apps" with a static Admin API access token -- confirmed
 * directly in the Shopify Admin "Develop apps" screen: "As of January 1,
 * 2026, you can no longer create new legacy custom apps." Every new app,
 * even a private single-store one, is now installed through the standard
 * OAuth authorization code grant. See routes/auth.ts for the OAuth
 * handshake that obtains and stores Store.accessToken. This middleware's
 * job is unchanged by that: it has nothing to do with how the token got
 * into the database, only with verifying who is calling our API *right
 * now*.
 *
 * What this verifies: the embedded admin page runs inside an iframe in
 * Shopify Admin, and App Bridge attaches a short-lived ID token (JWT) to
 * every request it makes to our backend (`Authorization: Bearer <token>`).
 * We verify that token with shopify.session.decodeSessionToken(), which:
 *   - checks the JWT signature against SHOPIFY_API_SECRET,
 *   - checks it hasn't expired,
 *   - returns `dest` (the shop's domain) and `sub` (the Shopify staff
 *     member's user id) from verified claims.
 *
 * This is what actually proves "this request came from someone with access
 * to this store's Shopify Admin," as opposed to trusting a client-supplied
 * `x-shopify-shop-domain` header outright.
 *
 * Because this is a private, single-store app (not distributed via the App
 * Store), any successfully-verified ID token is treated as coming from an
 * authorized admin -- there's no separate merchant-vs-staff permission
 * tier to check here the way there would be for a multi-user public app.
 */
export async function shopifyAdminAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.header("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

    if (!token) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    const payload = await shopifyApiClient.session.decodeSessionToken(token);

    // `dest` is a full URL (e.g. "https://fittez.myshopify.com"); normalize
    // to a bare domain to match how Store.shopDomain is stored.
    const shopDomain = payload.dest.replace(/^https?:\/\//, "");

    const store = await prisma.store.findUnique({ where: { shopDomain } });
    if (!store || !store.isActive) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    req.storeId = store.id;
    req.shopDomain = store.shopDomain;
    req.shopifyAccessToken = store.accessToken; // OAuth-derived token, written by routes/auth.ts
    req.isAdmin = true;
    req.adminId = payload.sub ?? "unknown-admin";
    next();
  } catch (err) {
    // decodeSessionToken throws on invalid signature, expired token, wrong
    // audience, etc. -- all of these are simply "not authenticated."
    req.log?.warn({ err: (err as Error).message }, "shopify_admin_id_token_verification_failed");
    res.status(401).json({ error: "Unauthorized." });
  }
}
