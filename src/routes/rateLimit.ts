import { Request, Response, NextFunction } from "express";

/**
 * Minimal IP-keyed rate limiter for order-enumeration protection
 * (Section 39). For production, swap this for a shared store (Redis) so
 * limits are enforced across multiple app instances.
 */
export default function rateLimit(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }

    if (entry.count >= opts.max) {
      return res.status(429).json({ error: "Too many attempts. Please try again later." });
    }

    entry.count += 1;
    next();
  };
}
