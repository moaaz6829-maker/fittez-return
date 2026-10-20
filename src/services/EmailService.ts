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

export async function sendEmail(to: string | null | undefined, subject: string, html: string): Promise<boolean> {
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
      { from, to: [to], subject, html },
      { headers: { Authorization: `Bearer ${key}` }, timeout: 15000 }
    );
    return true;
  } catch (err: any) {
    logger.error({ status: err?.response?.status, detail: err?.response?.data }, "email_send_failed");
    return false;
  }
}

function layout(titleEn: string, titleAr: string, bodyEn: string, bodyAr: string, trackingNumber?: string | null): string {
  const track = trackingNumber
    ? `<p style="margin:24px 0"><a href="${esc(bostaTrackingUrl(trackingNumber))}" style="background:#000;color:#fff;padding:12px 22px;text-decoration:none;font-weight:700;letter-spacing:1px">TRACK YOUR SHIPMENT / تتبّع شحنتك</a></p>
       <p style="color:#666;font-size:13px">Tracking number / رقم التتبع: <b>${esc(trackingNumber)}</b></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff">
    <div style="background:#000;color:#fff;padding:18px 24px;font-size:24px;font-weight:700;letter-spacing:3px">FITTEZ</div>
    <div style="padding:24px">
      <h2 style="margin:0 0 8px">${esc(titleEn)}</h2>
      <p style="margin:0 0 16px;color:#333">${bodyEn}</p>
      <hr style="border:none;border-top:1px solid #ddd;margin:20px 0">
      <div dir="rtl" style="text-align:right">
        <h2 style="margin:0 0 8px">${esc(titleAr)}</h2>
        <p style="margin:0 0 16px;color:#333">${bodyAr}</p>
      </div>
      ${track}
    </div>
    <div style="padding:16px 24px;color:#888;font-size:12px;border-top:1px solid #eee">FITTEZ</div>
  </div></body></html>`;
}

export interface ExchangeEmailData {
  customerEmail: string | null;
  customerName: string | null;
  orderName: string;
  trackingNumber?: string | null;
}

function hello(d: ExchangeEmailData, ar = false): string {
  const n = d.customerName ? esc(d.customerName) : "";
  return ar ? `أهلاً ${n}،` : `Hi ${n},`;
}

/** Phase 1 - the exchange was approved and the courier shipment is booked. */
export function sendExchangeApproved(d: ExchangeEmailData) {
  return sendEmail(
    d.customerEmail,
    `Your exchange for order ${d.orderName} is approved`,
    layout(
      "Exchange approved",
      "تمت الموافقة على الاستبدال",
      `${hello(d)}<br>Your exchange request for order <b>${esc(d.orderName)}</b> has been approved. Our courier (Bosta) will pick up the old item and deliver your new one.`,
      `${hello(d, true)}<br>تمت الموافقة على طلب الاستبدال الخاص بالأوردر <b>${esc(d.orderName)}</b>. مندوب بوسطة هيستلم المنتج القديم ويسلّمك الجديد.`,
      d.trackingNumber
    )
  );
}

/** Phase 2 - the courier is out for delivery. Includes the tracking link. */
export function sendExchangeOutForDelivery(d: ExchangeEmailData) {
  return sendEmail(
    d.customerEmail,
    `Your exchange for order ${d.orderName} is out for delivery`,
    layout(
      "Out for delivery",
      "الأوردر في الطريق إليك",
      `${hello(d)}<br>Your replacement for order <b>${esc(d.orderName)}</b> is out for delivery today. Please keep the old item ready for the courier.`,
      `${hello(d, true)}<br>المنتج البديل للأوردر <b>${esc(d.orderName)}</b> خرج للتسليم. من فضلك جهّز المنتج القديم للمندوب.`,
      d.trackingNumber
    )
  );
}

/** Phase 3 - delivered. */
export function sendExchangeDelivered(d: ExchangeEmailData) {
  return sendEmail(
    d.customerEmail,
    `Your exchange for order ${d.orderName} was delivered`,
    layout(
      "Delivered",
      "تم التسليم",
      `${hello(d)}<br>Your exchange for order <b>${esc(d.orderName)}</b> was delivered. Thank you for shopping with FITTEZ!`,
      `${hello(d, true)}<br>تم تسليم الاستبدال الخاص بالأوردر <b>${esc(d.orderName)}</b>. شكراً لتسوقك من FITTEZ!`,
      d.trackingNumber
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
