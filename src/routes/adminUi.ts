import { Router } from "express";
import fs from "fs";
import path from "path";

const router = Router();

const templatePath = path.join(__dirname, "../../public/admin/index.html.template");

/**
 * GET /admin
 *
 * Serves the embedded admin page shell. Deliberately UNAUTHENTICATED --
 * Shopify loads this inside an iframe before App Bridge has a chance to
 * attach an ID token to anything, so this route cannot require auth. It
 * must never render any sensitive data directly; all real data comes from
 * authenticated calls to /api/admin/* made by app.js after the page loads.
 *
 * The only thing injected server-side is the Custom App's public API key
 * (client id), which is not a secret -- required so App Bridge can
 * initialize via the `<meta name="shopify-api-key">` tag.
 */
router.get("/", (_req, res) => {
  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  const html = fs
    .readFileSync(templatePath, "utf8")
    .replace("__SHOPIFY_API_KEY__", apiKey);

  res.set("Content-Type", "text/html");
  res.send(html);
});

export default router;
