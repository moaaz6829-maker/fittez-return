import { Request, Response, NextFunction } from "express";

/**
 * Applied after shopifyAdminAuth, which already verifies the App Bridge ID
 * token and populates req.storeId/req.adminId from its verified claims.
 * This guard just confirms that step actually ran and succeeded -- it's
 * intentionally NOT re-deriving anything, since shopifyAdminAuth is the
 * single source of truth for "is this a legitimate embedded admin request."
 *
 * Private single-store Custom App note: there is no separate merchant-vs-
 * staff permission tier enforced here. Anyone who can open this store's
 * Shopify Admin (and therefore obtain a valid ID token for it) is treated
 * as an authorized admin. If FITTEZ later adds other staff accounts and
 * wants to restrict Test Mode toggling to a subset of them, that requires
 * looking up the verified `sub` (Shopify staff member id) against a
 * merchant-configured allowlist -- not needed for a single-owner app.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.storeId || !req.shopDomain || !req.isAdmin) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  next();
}
