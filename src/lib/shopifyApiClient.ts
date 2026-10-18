import "@shopify/shopify-api/adapters/node";
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";

/**
 * This client instance is used ONLY to decode/verify the ID token (formerly
 * "session token") that App Bridge attaches to requests from the embedded
 * admin page -- see shopify.session.decodeSessionToken() usage in
 * middleware/shopifyAuth.ts.
 *
 * It is NOT used for the OAuth install flow itself -- that's implemented
 * directly against Shopify's documented OAuth endpoints in routes/auth.ts
 * (not via this library's auth.begin()/auth.callback() helpers, which
 * expect a configured SessionStorage adapter FITTEZ doesn't otherwise use;
 * FITTEZ persists exactly one Store row per shop in Prisma instead).
 * `hostName`/`scopes` below are required by the library's config shape but
 * are not exercised by decodeSessionToken.
 */
export const shopifyApiClient = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY ?? "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET ?? "",
  scopes: (process.env.SHOPIFY_SCOPES ?? "").split(",").filter(Boolean),
  hostName: (process.env.SHOPIFY_APP_URL ?? "").replace(/^https?:\/\//, ""),
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
});
