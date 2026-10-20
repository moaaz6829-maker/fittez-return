/**
 * Section 5/6/7: eligibility rules.
 */
export interface EligibilityResult {
  eligible: boolean;
  reason?: "NOT_DELIVERED" | "WINDOW_EXPIRED";
}

const TZ = "Africa/Cairo";

/** Offset (ms) of Cairo time from UTC at a given instant (handles Egypt's DST). */
function cairoOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Calendar date (year, month0, day) of an instant, as seen in Cairo. */
function cairoYmd(at: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month") - 1, d: get("day") };
}

/** The UTC instant of 00:00 Cairo time on the given calendar date. */
function cairoMidnightUtc(y: number, m: number, d: number): Date {
  const guess = Date.UTC(y, m, d, 0, 0, 0);
  const first = guess - cairoOffsetMs(new Date(guess));
  return new Date(guess - cairoOffsetMs(new Date(first)));
}

export class EligibilityService {
  /**
   * Window = 3 calendar days counted from the DELIVERY date (never the order
   * date), in Cairo time: delivered Sep 1 -> eligible through the end of
   * Sep 3, not eligible from Sep 4 00:00 Cairo time.
   * Test Mode bypasses ONLY this check.
   */
  static checkDeliveryEligibility(
    deliveredAtIso: string | null,
    now: Date,
    testModeEnabled: boolean
  ): EligibilityResult {
    if (testModeEnabled) {
      return { eligible: true };
    }

    if (!deliveredAtIso) {
      return { eligible: false, reason: "NOT_DELIVERED" };
    }

    const delivered = cairoYmd(new Date(deliveredAtIso));
    const deadline = cairoMidnightUtc(delivered.y, delivered.m, delivered.d + 3);

    if (now.getTime() >= deadline.getTime()) {
      return { eligible: false, reason: "WINDOW_EXPIRED" };
    }

    return { eligible: true };
  }

  /**
   * Section 7: any variant/product with a Compare At Price is a Sale Item
   * and is ineligible for refund or exchange.
   */
  static isSaleItem(compareAtPrice: number | null): boolean {
    return compareAtPrice !== null && compareAtPrice !== undefined && compareAtPrice > 0;
  }
}
