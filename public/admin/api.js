/**
 * Thin wrapper around fetch() that attaches the App Bridge ID token to
 * every call to our own backend, per shopifyAdminAuth's expectations
 * (middleware/shopifyAuth.ts): `Authorization: Bearer <id token>`.
 *
 * window.shopify.idToken() is provided by the App Bridge script tag in
 * index.html.template. It returns a short-lived token that must be
 * fetched fresh for every request (it's not something to cache).
 */
async function fittezApi(path, options) {
  options = options || {};

  if (!window.shopify || typeof window.shopify.idToken !== "function") {
    throw new Error("App Bridge is not available. Open this page from inside Shopify Admin.");
  }

  const token = await window.shopify.idToken();

  const headers = Object.assign(
    {
      Authorization: "Bearer " + token,
    },
    options.body ? { "Content-Type": "application/json" } : {},
    options.headers || {}
  );

  const res = await fetch(path, {
    method: options.method || "GET",
    headers: headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error("Server returned an unexpected (non-JSON) response.");
    }
  }

  if (!res.ok) {
    const message = (data && data.error) || "Request failed (" + res.status + ").";
    throw new Error(message);
  }

  return data;
}
