import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "path";
import { logger } from "./lib/logger";
import { shopifyAdminAuth, shopifyCustomerFacingAuth } from "./middleware/shopifyAuth";

import authRouter from "./routes/auth";
import ordersRouter from "./routes/orders";
import refundsRouter from "./routes/refunds";
import exchangesRouter from "./routes/exchanges";
import bostaWebhookRouter from "./routes/bostaWebhook";
import adminRouter from "./routes/admin";
import adminUiRouter from "./routes/adminUi";

const app = express();

// Required for req.ip to reflect the real client IP (used by the Bosta
// webhook source-IP check) when running behind a load balancer/proxy.
// VERIFY the correct trust-proxy value for your actual deployment
// topology -- `true` trusts the immediate upstream proxy's X-Forwarded-For,
// which is appropriate behind a single trusted LB but not otherwise.
if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", true);
}

// helmet's defaults include X-Frame-Options: DENY and a restrictive
// frame-ancestors CSP, both of which would prevent Shopify Admin from
// embedding /admin in an iframe at all. We keep helmet's other
// protections but explicitly relax framing so the app can be embedded,
// scoped to Shopify's own domains (never a wildcard).
app.use(
  helmet({
    frameguard: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "frame-ancestors": ["https://admin.shopify.com", `https://${process.env.SHOPIFY_SHOP ?? ""}`],
        // helmet's CSP defaults restrict script-src to 'self', which blocks
        // the App Bridge script the embedded admin page loads from
        // cdn.shopify.com -- without this, window.shopify / idToken() never
        // becomes available and the page reports "App Bridge did not
        // initialize" even though everything else (OAuth, routing) worked.
        "script-src": ["'self'", "https://cdn.shopify.com"],
      },
    },
  })
);
app.use(cors({ origin: process.env.SHOPIFY_APP_URL, credentials: true }));
app.use(cookieParser());
app.use(pinoHttp({ logger }));

// The Bosta webhook route no longer needs raw-body capture: verification
// is a header-value shared-secret comparison (see BostaService /
// bostaWebhook.ts), not a body signature, per Bosta's documented webhook
// trust model. Standard JSON parsing is sufficient.
app.use(express.json({ limit: "1mb" }));

// Shopify OAuth install flow (see routes/auth.ts for why this exists --
// Shopify no longer issues static Custom App tokens for newly-created
// apps as of Jan 1, 2026). Intentionally unauthenticated: this IS the
// authentication handshake.
app.use("/auth", authRouter);

app.use("/api/bosta", bostaWebhookRouter);

// Customer-facing endpoints (Section 3): resolve store context from the
// single-tenant FITTEZ shop config, not from a client-supplied header.
app.use("/api/orders", shopifyCustomerFacingAuth, ordersRouter);
app.use("/api/refunds", shopifyCustomerFacingAuth, refundsRouter);
app.use("/api/exchanges", shopifyCustomerFacingAuth, exchangesRouter);

// Embedded Admin App endpoints (Section 40): verified App Bridge ID token.
app.use("/api/admin", shopifyAdminAuth, adminRouter);

// Embedded admin UI. /admin itself is intentionally unauthenticated (see
// routes/adminUi.ts); static assets (app.js) carry no secrets either.
app.use("/admin/static", express.static(path.join(__dirname, "../public/admin")));
app.use("/admin", adminUiRouter);

// Internal-only manual test harness for the customer-facing exchange flow
// (not the real theme-matched customer UI). Unauthenticated on purpose --
// it talks to the same /api/orders and /api/exchanges endpoints customers
// will eventually use, which resolve the store from SHOPIFY_SHOP rather
// than from a login. Remove this route before giving customers access.
app.use("/test", express.static(path.join(__dirname, "../public/test")));

// Public customer-facing Return / Exchange page (static, external JS only
// to satisfy the CSP). All business rules are enforced server-side by the
// /api/orders, /api/refunds and /api/exchanges routes above.
app.use("/returns", express.static(path.join(__dirname, "../public/returns")));

app.get("/health", (_req, res) => res.json({ ok: true }));

// Generic error handler -- never leak internals to the client (Section 40).
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  req.log?.error({ err }, "unhandled_error");
  res.status(500).json({ error: "Something went wrong. Please try again or contact FITTEZ." });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  logger.info({ port }, "fittez_refund_exchange_server_started");
});
