# FITTEZ Refund & Exchange

Production-oriented scaffold for the Shopify Embedded App described in the
FITTEZ Refund & Exchange spec: customer self-service refunds/exchanges,
fully automated Bosta Exchange shipping, and strict manual-only handling of
returned inventory.

This repo implements the **backend service layer, data model, and API
surface** in full. It intentionally leaves a few things as explicit,
clearly-marked TODOs rather than guessing — per the spec's own rule #24:
*"If any operation is uncertain, fail safely instead of guessing."*

---

## ⚠️ Bosta API verification status

A strict verification pass against Bosta's official static documentation
(`docs.bosta.co/docs/how-to/*`) was completed before any Bosta code was
written or changed. The interactive API Reference (`docs.bosta.co/api`) is
client-side rendered and could not be fetched programmatically, so its
content is NOT reflected below except where independently confirmed
elsewhere in the static docs.

### VERIFIED (confirmed in official static docs, implemented as documented)
- Endpoint + method: `POST https://app.bosta.co/api/v2/deliveries?apiVersion=1`
- Auth header: `Authorization: <raw API key>` (no `Bearer` prefix)
- Exchange type code: `30`
- Payload nesting: `specs.packageType`, `specs.packageDetails.{description,itemsCount}`
- `dropOffAddress` required for Exchange; `pickupAddress`/`businessLocationId` optional
- `businessReference` is a real field (free text, echoed on the delivery object and webhooks)
- No field exists to link an Exchange to an original shipment — confirmed absent
- Webhook delivery: your own endpoint via Dashboard or per-request `webhookUrl`/`webhookCustomHeaders`, fired on state change only
- Webhook payload fields/types: `_id`, `trackingNumber`, `state` (Number), `type`, `cod`, `timeStamp`, `isConfirmedDelivery`, `deliveryPromiseDate`, `exceptionReason`, `exceptionCode`, `businessReference`, `numberOfAttempts`
- Full numeric state-code table (10/20/21/22/23/24/30/46/47/48/49/100/101/102/103/104/105)
- Webhook trust model: **IP allowlist** (`34.89.199.241`, `35.246.223.19`) + **static shared-secret header** — explicitly **not** a cryptographic signature

### NOT VERIFIED (absent from static docs; not guessed, not implemented from third-party sources)
- Exact `receiver` object schema (field names, phone format)
- Exact `cod` field name/placement in the create payload
- Whether `goodsInfo` is required, and its schema
- Whether `uniqueBusinessReference` exists as a real, distinct Bosta field at all
- Any dedicated "search by reference" endpoint (none found — see IMPLEMENTED note below)
- Whether the creation response is enveloped (`{ data: {...} }`) or flat
- Exact `dropOffAddress`/`pickupAddress` schema (city/zone/district field names)
- A confirmed lightweight read-only endpoint for `testConnection()`

### IMPLEMENTED BASED ON VERIFIED DOCS
- `BostaService.buildExchangeDeliveryPayload()` — pure, unit-tested payload builder using only the confirmed field names/nesting; `receiver`/`dropOffAddress`/`cod` shapes are included because *something* is almost certainly required, but are isolated here specifically so they're easy to correct once confirmed (see NOT VERIFIED above)
- `isAllowedBostaSourceIp()` / `verifyWebhookSharedSecret()` — the two documented webhook trust mechanisms, replacing the previous fabricated HMAC scheme entirely
- `WebhookService.mapBostaStateToExchangeStatus()` — numeric state codes, gated on `type === "EXCHANGE"`
- `WebhookService`'s idempotency key is **synthesized** as `${trackingNumber}:${state}:${timeStamp}`, because Bosta's webhook payload has no documented unique event id field
- **No Bosta-side search/dedup exists in this codebase.** `ExchangeService` checks FITTEZ's own `BostaShipment` table (keyed by `exchangeRequestId`, which is itself unique per `idempotencyKey`) before ever calling Bosta. If a Bosta creation call throws for any reason (network error, timeout, 5xx), the request is marked `BOSTA_CREATION_AMBIGUOUS` and **never automatically retried** — an admin must check the Bosta Dashboard manually and call `resolveAmbiguousBostaCreation()` with the outcome
- `uniqueBusinessReference` is retained only as a FITTEZ-internal value (not sent to Bosta at all)

### REQUIRES BOSTA SUPPORT CONFIRMATION
1. Is there any endpoint to search/look up an existing delivery by `businessReference`, to make retries provably safe without manual reconciliation?
2. Is `uniqueBusinessReference` a real, distinct field from `businessReference`? Does Bosta deduplicate on either?
3. Exact `receiver` object schema (required/optional fields)?
4. Exact `dropOffAddress`/`pickupAddress` schema (city/zone/district/building/floor/apartment)?
5. Is the create-delivery response enveloped or flat, and are there additional Exchange-specific response fields?
6. Beyond IP allowlisting and a static header, is there any stronger verification available for a merchant handling COD amounts via webhook?
7. Is `cod` validated/calculated by Bosta, or purely whatever value FITTEZ sends?

Until items 1–2 are resolved, **any `BOSTA_CREATION_AMBIGUOUS` request requires a human to check the Bosta Dashboard** — this is a deliberate, documented limitation, not an oversight.

---

## Architecture

```
src/
  server.ts                 Express app wiring, webhook raw-body handling
  middleware/
    shopifyAuth.ts          Session resolution (customer + admin surfaces)
    requireAdmin.ts         Admin-only route guard
  lib/
    db.ts                   Prisma client singleton
    logger.ts                pino logger with secret redaction
    inventoryLock.ts        Application-level lease-based concurrency lock
    shopifyContext.ts       Per-request ShopifyService/BostaService factory
  services/
    ShopifyService.ts       All Shopify Admin GraphQL calls
    BostaService.ts         All Bosta API calls (Exchange creation, search, webhook verify)
    EligibilityService.ts   Delivered + 3-day window, Test Mode bypass, sale-item rule
    PricingService.ts       Server-side recalculation of every fee/total
    InventoryService.ts     Remaining-quantity tracking, locked final-check + deduction
    RefundService.ts        Refund request creation & validation
    ExchangeService.ts      Full exchange orchestration (Section 23 steps 1-23)
    WebhookService.ts       Idempotent Bosta webhook processing
  routes/
    orders.ts, refunds.ts, exchanges.ts, admin.ts, bostaWebhook.ts
  utils/
    phone.ts                 Egyptian + international phone normalization
    money.ts                 Refund/exchange formulas (piastre-precision)
    governorate.ts           Zone/fee seed data + DB-backed resolution
prisma/
  schema.prisma              Full data model
  seed.ts                    Seeds default zones/governorates + Settings row
```

### Money handling
All amounts are computed in integer piastres (`EGP * 100`) inside
`utils/money.ts` and only converted to decimal EGP at the boundary, to avoid
floating-point rounding errors on financial calculations. Verified against
every worked example in the spec (refund 850→740, exchange COD 217.4 /
17.4 / customer-credit 82.6 examples all match exactly).

### Concurrency-safe inventory (finalized decision)
`lib/inventoryLock.ts` implements the agreed strategy exactly:
1. **Application-level lock**, keyed by Shopify variant id, backed by a
   unique DB constraint + lease (`expiresAt`) so a crashed process can't
   hold it forever.
2. While holding the lock: re-check live Shopify inventory (final source of
   truth) → create the Bosta Exchange → deduct Shopify inventory — all
   inside the same critical section (`InventoryService.runLockedExchangeInventoryFlow`).
3. Shopify's `inventoryAdjustQuantities` (signed delta) is used for the
   deduction rather than an absolute `set`, as an additional safety layer —
   never described as a database-style row lock, per the finalization note.

### Quantity consumption (finalized decision)
`InventoryService.getRemainingEligibleQuantity` only counts a refund/
exchange as "consumed" once it reached a genuinely successful terminal
state (`REFUNDED`/`COMPLETED` for refunds; `BOSTA_EXCHANGE_CREATED` or later
for exchanges). Rejected, canceled, and pre-Bosta-failure requests consume
zero quantity, exactly as specified.

### Phone normalization (finalized decision)
`utils/phone.ts` normalizes Egyptian numbers (`01…`, `201…`, `+201…`,
with spaces/hyphens/parentheses) to a single canonical E.164 form, and
normalizes any other country's number to its own real E.164 form without
ever coercing it into an Egyptian number.

---

## Embedded Admin App: Custom App setup (no OAuth)

FITTEZ's app is a **Custom App** for your own store — not a public app
distributed via the Shopify App Store. This removes the entire OAuth
install flow, but the admin dashboard still needs to run *embedded* inside
Shopify Admin, which requires App Bridge + ID token verification. Here's
how the pieces fit together and what you need to do once.

### 1. Create the Custom App (one-time, in Shopify Admin)
1. Go to **Shopify Admin → Settings → Apps and sales channels → Develop apps**.
2. Click **Create an app**, name it "FITTEZ Refund & Exchange".
3. Under **Configuration**, set the **App URL** to your deployed backend's
   `/admin` route (e.g. `https://your-app-url.example.com/admin`) and add
   the same URL as an **Allowed redirection URL** (required by the screen
   even though this app doesn't use OAuth redirects).
4. Under **API credentials**, request the Admin API scopes listed in
   `.env.example` (`SHOPIFY_SCOPES`).
5. Click **Install app**. This immediately gives you three values — copy
   them into `.env`:
   - **API key** → `SHOPIFY_API_KEY`
   - **API secret key** → `SHOPIFY_API_SECRET`
   - **Admin API access token** (shown once) → `SHOPIFY_ADMIN_ACCESS_TOKEN`

There is no install/authorize screen for the merchant to click through —
because you *are* the merchant, this one-time setup is the entire
"installation."

### 2. Seed the static access token into the database
```bash
npx ts-node prisma/seed.ts
```
This reads `SHOPIFY_ADMIN_ACCESS_TOKEN` from your environment and stores it
on the `Store` row. All of `ShopifyService`'s Admin API calls use this
token directly — there's no refresh/rotation flow. If you ever regenerate
the token from the Develop apps screen, just re-run the seed script.

### 3. How the embedded admin page authenticates
Opening `{SHOPIFY_APP_URL}/admin` from inside Shopify Admin loads
`public/admin/index.html.template` (served via `routes/adminUi.ts`, with
your `SHOPIFY_API_KEY` injected into a `<meta name="shopify-api-key">` tag
— this is a public client identifier, not a secret). That page loads
Shopify's App Bridge script from their CDN, which:
1. Detects it's running in the iframe and initializes automatically.
2. Exposes `window.shopify.idToken()`, which returns a short-lived signed
   JWT proving the request is coming from someone with access to this
   store's Shopify Admin.

`public/admin/app.js` calls `shopify.idToken()` and attaches it as
`Authorization: Bearer <token>` on every call to `/api/admin/*`.
`middleware/shopifyAuth.ts`'s `shopifyAdminAuth` verifies that token with
`shopifyApiClient.session.decodeSessionToken()` (from `@shopify/shopify-api`,
using `SHOPIFY_API_SECRET`), extracts the shop domain (`dest` claim) and
staff id (`sub` claim), and only then allows the request through.

Right now `public/admin/index.html.template` is a minimal smoke-test page
that calls `/api/admin/settings` and shows the result — proving the auth
wiring works end-to-end. The real dashboard UI (request tables, refund/
exchange detail views, settings forms — Section 32/40/41 of the spec) is
still to be built on top of this same authenticated foundation.

### 4. Embedding/CSP note
`server.ts` explicitly relaxes `helmet`'s default frame-blocking (which
would otherwise prevent Shopify Admin from iframing `/admin` at all),
scoped specifically to `https://admin.shopify.com` and your own shop
domain — never a wildcard.

### Single-owner simplification (intentional)
Because this is a private app for one store with one effective admin user
(you), `middleware/requireAdmin.ts` does **not** implement a separate
Shopify staff-permission tier — any request with a validly verified ID
token for this store is treated as an authorized admin. If FITTEZ later
adds other staff accounts and wants to restrict Test Mode toggling to a
subset of them, that would need an allowlist check against the verified
`sub` claim, which isn't implemented here.

---

## Remaining items before production (not Bosta-related)

These are separate from the Bosta verification above — see that section for
everything Bosta-specific.

1. **Shopify variantId → inventoryItemId mapping** (`ExchangeService.ts`) —
   currently passed through as a placeholder; add a lookup (the GraphQL
   `productVariant.inventoryItem.id` field, already fetched in
   `ShopifyService.getSingleVariantAvailability`) and thread the real
   `inventoryItemId` through instead of reusing `variantId`.
2. **Bosta `businessLocationId` vs. Shopify `locationId`** — these are two
   different systems' location identifiers; `Settings.bostaBusinessLocationId`
   exists precisely so they aren't conflated, but `ExchangeService` currently
   passes the Shopify location id as a placeholder — wire the Bosta one in.
3. **Full drop-off address line** — `dropOffAddress.firstLine` needs the
   actual street address from the Shopify order, not the placeholder text
   currently in `ExchangeService.createExchange`.
4. **North Upper Egypt / South Upper Egypt / Region 6 governorate lists**
   (`utils/governorate.ts`) — only "Delta and Canal" was explicitly
   enumerated in the spec; the others are reasonable defaults FITTEZ should
   confirm in Settings > Governorate Mapping before go-live.
5. **Multi-item exchange locking** — `ExchangeService.createExchange`
   currently drives the locked Bosta+inventory critical section off a
   single "primary" replacement item as a reference implementation; a
   production multi-item exchange needs to acquire/release each variant's
   lock sequentially (never simultaneously, to avoid lock-ordering
   deadlocks) inside one Bosta shipment creation call.
6. ~~Shopify OAuth session verification~~ **DONE** — replaced with real
   App Bridge ID token verification via `shopifyApiClient.session.decodeSessionToken()`;
   see "Embedded Admin App: Custom App setup" above. No OAuth needed since
   this is a Custom App with a static Admin API access token.
7. ~~Admin staff-level permission check~~ **Resolved for this app's actual
   shape** — see "Single-owner simplification" above; revisit only if
   FITTEZ later adds multiple staff accounts with different permission tiers.
8. **FITTEZ theme CSS integration** — this repo is backend/API only. The
    customer-facing `fittez.com/refund-exchange` frontend (Section 2) should
    be built as a themed Shopify page/app-embed pulling the actual theme's
    CSS variables, fonts (Inter, Barlow Condensed 600), and component
    classes from the uploaded theme ZIP — not included in this scaffold.
9. **`req.ip` reliability for the Bosta IP allowlist check** — only
   trustworthy if `TRUST_PROXY` and your actual load balancer configuration
   agree; verify this in your real deployment topology before relying on
   the IP check for anything beyond logging/visibility.
10. **The real embedded admin dashboard UI** — `/admin` currently only
    proves the auth wiring works (a single smoke-test page). The actual
    request tables, refund/exchange detail views, and settings forms from
    Section 32/40/41 of the spec still need to be built as authenticated
    calls to the existing `/api/admin/*` routes.

None of the above are silent gaps — each is called out inline in code
comments at the exact call site, consistent with spec rule #5: *"Do NOT
invent API fields... fail safely and clearly isolate the unsupported
operation for Admin review."*

---

## Testing

```bash
npm test
```

32 tests currently cover:
- `BostaService`: exact endpoint URL (`/deliveries?apiVersion=1`), `type: 30`,
  nested `specs.packageDetails` payload shape, raw (non-Bearer) auth header,
  that `uniqueBusinessReference`/original-tracking fields are never sent
- Webhook trust model: IP allowlist matching, shared-secret accept/reject/
  missing/length-mismatch cases (no HMAC)
- `WebhookService`: numeric state-code mapping, `type === "EXCHANGE"` gating,
  distinguishing "recognized code with no mapped status" from "wrong type"
- `ExchangeService`: repeat submissions with the same idempotency key never
  call Bosta twice; a thrown/timed-out Bosta call marks the request
  `BOSTA_CREATION_AMBIGUOUS` without creating a `BostaShipment` row; a
  second submission against an already-ambiguous request still doesn't
  retry Bosta automatically; `resolveAmbiguousBostaCreation` correctly
  resets a confirmed-not-created request back to a retryable state
- `shopifyAdminAuth`: rejects missing/malformed/invalid/expired tokens,
  rejects a valid token for an unknown shop, accepts a valid token for a
  known active store and correctly populates `req.storeId`/`req.adminId`
  from verified claims; `requireAdmin` passes through only when that
  context is present

Money/pricing formulas and phone normalization are exercised indirectly
through the `ExchangeService` tests' fixtures; dedicated `money.test.ts`/
`phone.test.ts` unit tests are a reasonable next addition if you want them
tested in isolation from the exchange flow.

---

## Setup

```bash
cp .env.example .env
# fill in SHOPIFY_*, DATABASE_URL, BOSTA_* values

npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:generate # again after first migrate if needed
npx ts-node prisma/seed.ts

npm run dev
```

### Local development
- Requires PostgreSQL (`DATABASE_URL`).
- Requires a Shopify Partner app configured with the scopes in
  `.env.example` (`SHOPIFY_SCOPES`) and OAuth redirect pointed at
  `SHOPIFY_APP_URL`.
- Requires a Bosta account + API key for anything beyond
  `/api/admin/bosta/test-connection`.

### Database
- `prisma/schema.prisma` is the source of truth for all models in Section
  37/45 of the spec (Store, RefundRequest/Item, ExchangeRequest/Item,
  InventoryTransaction, InventoryLock, BostaShipment, BostaWebhookEvent,
  AdminAction, ShippingZone/Rate, Settings, AuditLog).
- Run `npm run prisma:migrate` to create tables; `prisma/seed.ts` populates
  the default governorate → zone → fee mapping and a default `Settings` row
  (Test Mode OFF, 110 EGP refund fee).

### Bosta webhook configuration
Point Bosta's webhook config at:
```
POST {SHOPIFY_APP_URL}/api/bosta/webhook
```
Set `BOSTA_WEBHOOK_SECRET` to match whatever Bosta's dashboard/API expects
for signing (confirm the exact mechanism per the VERIFY items above before
relying on it in production).

### Production deployment checklist
1. Resolve all 10 `VERIFY` items above.
2. Run the Section 58-mandated controlled real Bosta Exchange test.
3. Confirm governorate mapping with FITTEZ.
4. Set `NODE_ENV=production`, run `npm run build && npm start` behind
   HTTPS with the raw-body webhook route reachable (some platforms buffer/
   transform bodies — verify raw bytes reach `bostaWebhook.ts` unmodified).
5. Rotate `APP_SESSION_SECRET` / `BOSTA_WEBHOOK_SECRET` out of `.env` into a
   real secret manager for production; `.env` is for local dev only.
