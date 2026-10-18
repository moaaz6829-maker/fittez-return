import { Request } from "express";
import { ShopifyService } from "../services/ShopifyService";
import { BostaService } from "../services/BostaService";

/**
 * These helpers assume an upstream auth middleware (Shopify OAuth session
 * middleware, e.g. from `@shopify/shopify-api`) has already populated
 * `req.storeId`, `req.shopDomain`, and `req.shopifyAccessToken` from the
 * verified session -- never from a client-supplied header. See
 * src/middleware/shopifyAuth.ts for where that happens.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      storeId?: string;
      shopDomain?: string;
      shopifyAccessToken?: string;
      isAdmin?: boolean;
      adminId?: string;
    }
  }
}

export function getShopifyServiceForRequest(req: Request): ShopifyService {
  if (!req.shopDomain || !req.shopifyAccessToken) {
    throw new Error("Missing authenticated Shopify session on request.");
  }
  return new ShopifyService(req.shopDomain, req.shopifyAccessToken);
}

export function getBostaService(): BostaService {
  const apiKey = process.env.BOSTA_API_KEY;
  const baseUrl = process.env.BOSTA_API_BASE_URL;
  if (!apiKey || !baseUrl) {
    throw new Error("BOSTA_API_KEY / BOSTA_API_BASE_URL not configured.");
  }
  return new BostaService(apiKey, baseUrl);
}
