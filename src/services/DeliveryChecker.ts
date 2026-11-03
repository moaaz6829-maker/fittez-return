import axios from "axios";
import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { sendExchangeDelivered } from "./EmailService";

/**
 * Automatic delivery check for exchanges that are "out for delivery".
 * Every hour from 2 PM to 10 PM (Cairo time) it looks up each shipment's
 * Bosta tracking number on Bosta's public tracking endpoint. When Bosta says
 * the shipment is delivered, the exchange is marked COMPLETED and the customer
 * gets the "your order is delivered" email (once).
 */

const BOSTA_TRACK_URL = "https://tracking.bosta.co/shipments/track/";
const BOSTA_DELIVERED_CODE = 45;
const FIRST_HOUR = 14; // 2 PM Cairo
const LAST_HOUR = 22; // 10 PM Cairo

let lastRunKey = "";
let running = false;

function cairoSlot(): { hour: number; key: string } {
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "numeric", hourCycle: "h23" }).format(now)
  );
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(now);
  return { hour, key: `${day}-${hour}` };
}

export async function runDeliveryCheck(): Promise<void> {
  const shipped = await prisma.exchangeRequest.findMany({
    where: { status: "REPLACEMENT_SHIPPED", bostaTrackingNumber: { not: null } },
  });
  for (const ex of shipped) {
    const tn = ex.bostaTrackingNumber;
    if (!tn) continue;
    try {
      const res = await axios.get(BOSTA_TRACK_URL + encodeURIComponent(tn), { timeout: 15000 });
      const code = Number(res.data?.CurrentStatus?.code);
      if (code !== BOSTA_DELIVERED_CODE) continue;
      // updateMany with the status guard makes sure only one run sends the email.
      const claimed = await prisma.exchangeRequest.updateMany({
        where: { id: ex.id, status: "REPLACEMENT_SHIPPED" },
        data: { status: "COMPLETED" },
      });
      if (claimed.count !== 1) continue;
      await prisma.exchangeRequest.update({
        where: { id: ex.id },
        data: { auditLogs: { create: { action: "AUTO_MARKED_DELIVERED", actorType: "SYSTEM" } } },
      });
      void sendExchangeDelivered({
        customerEmail: ex.customerEmail,
        customerName: ex.customerName,
        orderName: ex.shopifyOrderName,
        trackingNumber: tn,
      });
      logger.info({ exchangeRequestId: ex.id }, "exchange_auto_delivered");
    } catch (err) {
      logger.warn({ exchangeRequestId: ex.id, err: (err as Error).message }, "delivery_check_failed");
    }
  }
}

async function tick(): Promise<void> {
  const { hour, key } = cairoSlot();
  if (hour < FIRST_HOUR || hour > LAST_HOUR || key === lastRunKey || running) return;
  running = true;
  lastRunKey = key;
  try {
    await runDeliveryCheck();
  } catch (err) {
    logger.error({ err: (err as Error).message }, "delivery_check_run_failed");
  } finally {
    running = false;
  }
}

/** Starts the checker (checks the clock every 5 minutes, runs once per hour in the window). */
export function startDeliveryChecker(): void {
  setInterval(() => void tick(), 5 * 60 * 1000);
  setTimeout(() => void tick(), 60 * 1000);
  logger.info("delivery_checker_started");
}
