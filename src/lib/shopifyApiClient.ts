import "@shopify/shopify-api/adapters/node";
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";

/**
 * This client instance exists ONLY to decode/verify the ID token (formerly
 * "session token") that App Bridge attaches to requests from the embedded
 * admin page -- see shopify.session.decodeSessionToken() usage in
 * middleware/shopifyAuth.ts.
 *
 * It is NOT used for OAuth (we don't need it -- FITTEZ's app is a Custom
 * App created via Shopify Admin > Settings > Apps and sales channels >
 * Develop apps, which issues a static Admin API access token directly, no
 * install/OAuth flow at all). `hostName`/`scopes` below are required by the
 * library's config shape but are unused in our flow.
 */
export const shopifyApiClient = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY ?? "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET ?? "",
  scopes: (process.env.SHOPIFY_SCOPES ?? "").split(",").filter(Boolean),
  hostName: (process.env.SHOPIFY_APP_URL ?? "").replace(/^https?:\/\//, ""),
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
});
