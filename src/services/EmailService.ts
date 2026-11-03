import axios from "axios";
import { logger } from "../lib/logger";
import { bostaTrackingUrl } from "./BostaService";

/**
 * Customer status emails, sent through Resend's HTTP API.
 * Needs two environment variables on the server:
 *   RESEND_API_KEY  - API key from resend.com
 *   EMAIL_FROM      - e.g. "FITTEZ <orders@fittez.com>" (a domain verified in Resend)
 * If either is missing, emails are skipped (logged) and nothing else breaks.
 * An email failure NEVER blocks an approval or a shipment update.
 */

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface EmailAttachment {
  filename: string;
  content: string; // base64
  content_id?: string;
}

export async function sendEmail(
  to: string | null | undefined,
  subject: string,
  html: string,
  attachments?: EmailAttachment[]
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!to) {
    logger.info("email_skipped_no_recipient");
    return false;
  }
  if (!key || !from) {
    logger.warn("email_skipped_not_configured");
    return false;
  }
  try {
    await axios.post(
      "https://api.resend.com/emails",
      {
        from,
        to: [to],
        reply_to: process.env.EMAIL_REPLY_TO || "support@fittez.com",
        subject,
        html,
        ...(attachments && attachments.length ? { attachments } : {}),
      },
      { headers: { Authorization: `Bearer ${key}` }, timeout: 15000 }
    );
    return true;
  } catch (err: any) {
    logger.error({ status: err?.response?.status, detail: err?.response?.data }, "email_send_failed");
    return false;
  }
}

const HEAD = "'Barlow Condensed','Arial Narrow',Arial,Helvetica,sans-serif";
const LOGO_URL = "https://fittez.com/cdn/shop/files/Photoroom_20260319_51906_PM.png?width=600&height=240&crop=center";
const BODY = "Inter,Arial,Helvetica,sans-serif";

// English-only emails. The Arabic arguments are kept in the signature but are intentionally not rendered.
function layout(titleEn: string, _titleAr: string, bodyEn: string, _bodyAr: string, trackingNumber?: string | null, cta?: { label: string; url: string } | null): string {
  const track = trackingNumber
    ? `<p style="margin:26px 0 14px"><a href="${esc(bostaTrackingUrl(trackingNumber))}" style="display:inline-block;background:#ffffff;color:#000000;padding:13px 26px;text-decoration:none;font-family:${HEAD};font-weight:700;font-size:16px;letter-spacing:1.5px;text-transform:uppercase">Track your shipment</a></p>
       <p style="color:#9a9a9a;font-size:13px;margin:0">Tracking number: <b style="color:#ffffff">${esc(trackingNumber)}</b></p>`
    : "";
  const ctaHtml = cta
    ? `<p style="margin:26px 0 6px"><a href="${esc(cta.url)}" style="display:inline-block;background:#ffffff;color:#000000;padding:13px 26px;text-decoration:none;font-family:${HEAD};font-weight:700;font-size:16px;letter-spacing:1.5px;text-transform:uppercase">${esc(cta.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#000000;font-family:${BODY};color:#ffffff">
  <div style="max-width:560px;margin:0 auto;background:#000000">
    <div style="padding:10px 24px;border-bottom:1px solid #2a2a2a;text-align:center"><img src="${LOGO_URL}" width="300" height="120" alt="FITTEZ" style="display:inline-block;border:0;outline:none;color:#ffffff;font-family:${HEAD};font-size:30px;font-weight:700;letter-spacing:3px"></div>
    <div style="padding:28px 24px">
      <h2 style="margin:0 0 14px;font-family:${HEAD};font-size:28px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#ffffff">${esc(titleEn)}</h2>
      <div style="border:1px solid #2a2a2a;background:#0d0d0d;padding:18px;font-size:15px;line-height:1.6;color:#e6e6e6">${bodyEn}</div>
      ${track}${ctaHtml}
    </div>
    <div style="padding:18px 24px;color:#9a9a9a;font-size:12px;border-top:1px solid #2a2a2a;letter-spacing:1px">FITTEZ &middot; Questions? Reply to this email.</div>
  </div></body></html>`;
}

export interface ExchangeEmailData {
  customerEmail: string | null;
  customerName: string | null;
  orderName: string;
  trackingNumber?: string | null;
  /** Old item(s) and new item(s) shown as product cards in the approval email. */
  pairs?: ExchangeEmailPair[];
  /** Money summary (all in EGP). */
  money?: ExchangeEmailMoney;
}

export interface ExchangeEmailMoney {
  returnedTotal: number;
  replacementTotal: number;
  fee: number;
  /** Amount the customer pays the courier on delivery (0 = nothing to pay). */
  cod: number;
  /** Amount we send back to the customer (0 = none). */
  credit: number;
  refundMethod?: string | null;
  refundMobile?: string | null;
}

export interface ExchangeEmailPair {
  oldTitle: string;
  oldVariant: string;
  oldQty: number;
  oldImage: string | null;
  newTitle: string;
  newVariant: string;
  newQty: number;
  newImage: string | null;
}

function egp(n: number): string {
  return `${Math.round(n)} EGP`;
}

function methodLabel(m?: string | null): string {
  return m === "INSTAPAY" ? "InstaPay" : m === "E_WALLET" ? "e-wallet" : "";
}

function moneyBox(rows: Array<[string, string]>, highlight?: [string, string] | null): string {
  const lines = rows
    .map(([k, v]) => `<tr><td style="padding:4px 0;color:#9a9a9a">${esc(k)}</td><td style="padding:4px 0;text-align:right;color:#ffffff">${esc(v)}</td></tr>`)
    .join("");
  const hi = highlight
    ? `<tr><td colspan="2" style="padding-top:10px;border-top:1px solid #2a2a2a;font-size:16px;color:#ffffff"><b>${esc(highlight[0])}</b> <b style="float:right;font-size:18px">${esc(highlight[1])}</b></td></tr>`
    : "";
  return `<table role="presentation" width="100%" style="margin:16px 0 4px;font-size:14px;border-collapse:collapse">${lines}${hi}</table>`;
}

function exchangeMoney(m?: ExchangeEmailMoney): string {
  if (!m) return "";
  const rows: Array<[string, string]> = [
    ["Returned item(s)", egp(m.returnedTotal)],
    ["New item(s)", egp(m.replacementTotal)],
    ["Exchange fee", egp(m.fee)],
  ];
  let hi: [string, string] | null = null;
  let note = "";
  if (m.credit > 0) {
    hi = ["We will send you back", egp(m.credit)];
    const how = methodLabel(m.refundMethod);
    note = `<p style="margin:8px 0 0;font-size:13px;color:#9a9a9a">Sent to your ${how ? esc(how) : "wallet"}${m.refundMobile ? ` number ${esc(m.refundMobile)}` : ""} after your new item is delivered.</p>`;
  } else if (m.cod > 0) {
    hi = ["To pay on delivery", egp(m.cod)];
  } else {
    hi = ["To pay on delivery", "0 EGP"];
  }
  return moneyBox(rows, hi) + note;
}

function productCard(label: string, title: string, variant: string, qty: number, imageUrl: string | null): string {
  return `<p style="margin:14px 0 4px;font-family:${HEAD};font-size:15px;letter-spacing:1.5px;text-transform:uppercase;color:#9a9a9a">${esc(label)}</p>
    <table role="presentation" width="100%" style="border:1px solid #2a2a2a;background:#000;border-collapse:collapse"><tr>
      <td width="84" style="padding:8px">${imageUrl ? `<img src="${esc(imageUrl)}" width="76" height="76" style="display:block;object-fit:cover" alt="">` : ""}</td>
      <td style="padding:8px;font-size:14px;color:#ffffff"><b>${esc(title)}</b><br><span style="color:#9a9a9a">${esc(variant)} &times; ${qty}</span></td>
    </tr></table>`;
}

function hello(d: ExchangeEmailData, ar = false): string {
  const n = d.customerName ? esc(d.customerName) : "";
  return ar ? `أهلاً ${n}،` : `Hi ${n},`;
}

/** Sent right after the customer submits an exchange request. */
export function sendExchangeRequested(d: ExchangeEmailData) {
  const cards = (d.pairs ?? [])
    .map(
      (p) =>
        productCard("Returning (old item)", p.oldTitle, p.oldVariant, p.oldQty, p.oldImage) +
        productCard("Your new item", p.newTitle, p.newVariant, p.newQty, p.newImage)
    )
    .join("");
  return sendEmail(
    d.customerEmail,
    `We received your exchange request for order ${d.orderName}`,
    layout(
      "Exchange request received",
      "",
      `${hello(d)}<br>We received your exchange request for order <b>${esc(d.orderName)}</b>. Our team is reviewing it and we will email you as soon as it is approved.${cards}${exchangeMoney(d.money)}`,
      ""
    )
  );
}

export interface RefundRequestedEmailData {
  customerEmail: string | null;
  customerName: string | null;
  orderName: string;
  items: Array<{ title: string; variant: string; quantity: number; lineTotal: number }>;
  subtotal: number;
  fee: number;
  finalAmount: number;
  refundMethod?: string | null;
  refundMobile?: string | null;
}

/** Sent right after the customer submits a refund request. */
export function sendRefundRequested(d: RefundRequestedEmailData) {
  const items = d.items
    .map(
      (i) => `<table role="presentation" width="100%" style="border:1px solid #2a2a2a;background:#000;margin:8px 0;border-collapse:collapse"><tr>
        <td style="padding:10px;font-size:14px;color:#ffffff"><b>${esc(i.title)}</b><br><span style="color:#9a9a9a">${esc(i.variant)} &times; ${i.quantity}</span></td>
        <td style="padding:10px;font-size:14px;text-align:right;white-space:nowrap;color:#ffffff"><b>${egp(i.lineTotal)}</b></td>
      </tr></table>`
    )
    .join("");
  const how = methodLabel(d.refundMethod);
  const note = `<p style="margin:8px 0 0;font-size:13px;color:#9a9a9a">Sent to your ${how ? esc(how) : "wallet"}${d.refundMobile ? ` number ${esc(d.refundMobile)}` : ""} once your refund is processed.</p>`;
  const name = d.customerName ? esc(d.customerName) : "";
  return sendEmail(
    d.customerEmail,
    `We received your refund request for order ${d.orderName}`,
    layout(
      "Refund request received",
      "",
      `Hi ${name},<br>We received your refund request for order <b>${esc(d.orderName)}</b>. Our team is reviewing it and we will email you as soon as it is approved.${items}${moneyBox(
        [
          ["Items", egp(d.subtotal)],
          ["Refund fee", egp(d.fee)],
        ],
        ["You will receive", egp(d.finalAmount)]
      )}${note}`,
      ""
    )
  );
}

/** Email 1 - the exchange was approved. Shows the old and the new product. No tracking yet. */
export function sendExchangeApproved(d: ExchangeEmailData) {
  const cards = (d.pairs ?? [])
    .map(
      (p) =>
        productCard("Returning (old item)", p.oldTitle, p.oldVariant, p.oldQty, p.oldImage) +
        productCard("Your new item", p.newTitle, p.newVariant, p.newQty, p.newImage)
    )
    .join("");
  return sendEmail(
    d.customerEmail,
    `Your exchange for order ${d.orderName} is approved`,
    layout(
      "Exchange approved",
      "",
      `${hello(d)}<br>Your exchange request for order <b>${esc(d.orderName)}</b> has been <b>approved</b>. Your new item will be shipped as soon as possible, and we will email you the tracking link once it is on its way.${cards}${exchangeMoney(d.money)}`,
      ""
    )
  );
}

/** Email 2 - sent when the tracking number is added: out for delivery, expected within 2 days. */
export function sendExchangeOutForDelivery(d: ExchangeEmailData) {
  return sendEmail(
    d.customerEmail,
    `Your exchange for order ${d.orderName} is out for delivery`,
    layout(
      "Out for delivery",
      "",
      `${hello(d)}<br>Your new item for order <b>${esc(d.orderName)}</b> is <b>out for delivery</b>. Expected to be delivered <b>within 2 days</b>.<br>Please keep the old item ready for the courier. You can follow your shipment with the tracking link below.`,
      "",
      d.trackingNumber
    )
  );
}

/** Email 3 - delivered (sent automatically when Bosta shows the shipment as delivered). */
export function sendExchangeDelivered(d: ExchangeEmailData) {
  const wa = (process.env.WHATSAPP_NUMBER || "").replace(/[^0-9]/g, "");
  return sendEmail(
    d.customerEmail,
    `Your exchange for order ${d.orderName} was delivered`,
    layout(
      "Your order is delivered",
      "",
      `${hello(d)}<br>Your exchange for order <b>${esc(d.orderName)}</b> has been delivered. Thank you for shopping with FITTEZ, we hope your experience with us was great!<br><br>We would love to hear what you think. Leave us a review or send us your feedback on WhatsApp${wa ? "" : " (just reply to this email)"}.`,
      "",
      null,
      wa ? { label: "Message us on WhatsApp", url: `https://wa.me/${wa}` } : null
    )
  );
}

export function sendExchangeRejected(d: ExchangeEmailData, reason?: string | null) {
  const extraEn = reason ? `<br>Reason: ${esc(reason)}` : "";
  const extraAr = reason ? `<br>السبب: ${esc(reason)}` : "";
  return sendEmail(
    d.customerEmail,
    `Your exchange request for order ${d.orderName}`,
    layout(
      "Exchange request not approved",
      "لم تتم الموافقة على طلب الاستبدال",
      `${hello(d)}<br>Unfortunately we could not approve your exchange request for order <b>${esc(d.orderName)}</b>.${extraEn}<br>Please contact FITTEZ if you have questions.`,
      `${hello(d, true)}<br>للأسف مقدرناش نوافق على طلب الاستبدال الخاص بالأوردر <b>${esc(d.orderName)}</b>.${extraAr}<br>تواصل مع FITTEZ لو عندك أي استفسار.`
    )
  );
}


export interface RefundEmailItem {
  title: string;
  variant: string;
  quantity: number;
  lineTotal: number;
  imageUrl: string | null;
}

export interface RefundEmailData {
  customerEmail: string | null;
  customerName: string | null;
  orderName: string;
  items: RefundEmailItem[];
  subtotal: number;
  fee: number;
  finalAmount: number;
  proofImageDataUrl?: string | null;
}

/** Sent when the refund has been paid out. Includes the payout screenshot (if uploaded) and product cards. */
export function sendRefundFinalized(d: RefundEmailData) {
  const cards = d.items
    .map(
      (i) => `<table role="presentation" width="100%" style="border:1px solid #2a2a2a;background:#000;margin:8px 0"><tr>
        <td width="84" style="padding:8px">${i.imageUrl ? `<img src="${esc(i.imageUrl)}" width="76" height="76" style="display:block;object-fit:cover" alt="">` : ""}</td>
        <td style="padding:8px;font-size:14px"><b>${esc(i.title)}</b><br><span style="color:#9a9a9a">${esc(i.variant)} &times; ${i.quantity}</span></td>
        <td style="padding:8px;font-size:14px;text-align:right;white-space:nowrap"><b>${i.lineTotal.toFixed(0)} EGP</b></td>
      </tr></table>`
    )
    .join("");
  const attachments: EmailAttachment[] = [];
  let proof = "";
  const m = d.proofImageDataUrl ? /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(d.proofImageDataUrl) : null;
  if (m) {
    const ext = m[1] === "jpeg" ? "jpg" : m[1];
    attachments.push({ filename: `refund-proof.${ext}`, content: m[2], content_id: "refundproof" });
    proof = `<p style="margin:16px 0 6px"><b>Transfer receipt</b></p><img src="cid:refundproof" style="max-width:100%;border:1px solid #2a2a2a" alt="Refund receipt">`;
  }
  const money = `<p style="margin:12px 0;font-size:14px">Items: <b>${d.subtotal.toFixed(0)}</b> EGP &nbsp;|&nbsp; Fee: <b>${d.fee.toFixed(0)}</b> EGP<br>
    Refunded: <b style="font-size:18px">${d.finalAmount.toFixed(0)} EGP</b></p>`;
  const body = `${money}${cards}${proof}`;
  const name = esc(d.customerName ?? "");
  const html = layout(
    "Your refund has been sent",
    "تم تحويل المبلغ المسترد",
    `Hi ${name}, your refund for order ${esc(d.orderName)} is complete.${body}`,
    `أهلاً ${name}، تم تحويل مبلغ الاسترجاع لطلب ${esc(d.orderName)}.`
  );
  return sendEmail(d.customerEmail, `FITTEZ - Refund sent for ${d.orderName}`, html, attachments);
}
