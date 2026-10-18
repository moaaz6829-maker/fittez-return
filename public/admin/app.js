/**
 * Minimal App Bridge glue for the FITTEZ embedded admin page.
 *
 * The App Bridge script tag (loaded in index.html via
 * https://cdn.shopify.com/shopifycloud/app-bridge.js) exposes a `shopify`
 * global once it initializes using the <meta name="shopify-api-key"> tag.
 * `shopify.idToken()` returns a short-lived JWT proving this page is
 * genuinely embedded in an authenticated Shopify Admin session; our
 * backend verifies it with shopify.session.decodeSessionToken() (see
 * middleware/shopifyAuth.ts).
 *
 * This file intentionally does the auth call manually (rather than relying
 * solely on App Bridge's fetch interceptor) so the smoke test below is
 * explicit about what's happening -- once the real dashboard UI is built,
 * standard `fetch` calls to same-origin `/api/admin/*` routes will have the
 * ID token attached automatically by App Bridge's interceptor.
 */

async function callAdminApi(path) {
  const token = await window.shopify.idToken();
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  return { ok: res.ok, status: res.status, body };
}

async function runSmokeTest() {
  const statusEl = document.getElementById("status");
  try {
    const { ok, status, body } = await callAdminApi("/api/admin/settings");
    if (ok) {
      statusEl.textContent =
        "✅ ID token verified. /api/admin/settings responded:\n" +
        JSON.stringify(body, null, 2);
      statusEl.className = "ok";
    } else {
      statusEl.textContent = `❌ Backend rejected the request (HTTP ${status}):\n` +
        JSON.stringify(body, null, 2);
      statusEl.className = "err";
    }
  } catch (err) {
    statusEl.textContent = "❌ Failed to complete the auth smoke test: " + err.message;
    statusEl.className = "err";
  }
}

// App Bridge initializes asynchronously from the meta tag; give it a tick.
window.addEventListener("DOMContentLoaded", () => {
  if (window.shopify && typeof window.shopify.idToken === "function") {
    runSmokeTest();
  } else {
    document.getElementById("status").textContent =
      "App Bridge did not initialize. This page must be opened embedded " +
      "inside Shopify Admin (via the Custom App's app URL), not directly.";
    document.getElementById("status").className = "err";
  }
});
