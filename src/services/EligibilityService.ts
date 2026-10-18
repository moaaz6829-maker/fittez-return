/**
 * Section 5/6/7: eligibility rules.
 */
export interface EligibilityResult {
  eligible: boolean;
  reason?: "NOT_DELIVERED" | "WINDOW_EXPIRED";
}

export class EligibilityService {
  /**
   * Section 5: eligible until the END of the third calendar day after
   * deliveredAt. Test Mode (Section 6) bypasses ONLY this check -- nothing
   * else in the flow is skipped.
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

    const deliveredAt = new Date(deliveredAtIso);

    // "End of the third calendar day after delivery": if delivered Sep 1,
    // eligible through end-of-day Sep 3, not eligible from Sep 4 00:00.
    const deadline = new Date(
      deliveredAt.getFullYear(),
      deliveredAt.getMonth(),
      deliveredAt.getDate() + 3,
      0,
      0,
      0,
      0
    ); // midnight starting day 4 relative to delivery day (day 0)

    if (now.getTime() >= deadline.getTime()) {
      return { eligible: false, reason: "WINDOW_EXPIRED" };
    }

    return { eligible: true };
  }

  /**
   * Section 7: any variant/product with a Compare At Price is a Sale Item
   * and is ineligible for refund or exchange. This is confirmed as the
   * official FITTEZ rule (not tags/metafields) and re-verified server-side
   * regardless of what the frontend sent.
   */
  static isSaleItem(compareAtPrice: number | null): boolean {
    return compareAtPrice !== null && compareAtPrice !== undefined && compareAtPrice > 0;
  }
}
