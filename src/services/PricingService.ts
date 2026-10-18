import { calculateExchange, calculateRefund } from "../utils/money";
import { resolveZoneForGovernorate } from "../utils/governorate";

/**
 * Section 45/53: the backend is the ONLY source of truth for prices, fees,
 * governorate, and COD. Every value the frontend displays is re-derived
 * here from Shopify line-item prices + DB-configured fees; nothing sent by
 * the browser (a submitted "total" or "fee") is ever trusted or persisted
 * without being recomputed first.
 */
export class PricingService {
  static computeRefund(productValueEgp: number, refundFeeEgp: number) {
    return calculateRefund(productValueEgp, refundFeeEgp);
  }

  static async computeExchange(params: {
    storeId: string;
    governorateName: string;
    returnedTotalEgp: number;
    replacementTotalEgp: number;
  }) {
    const zone = await resolveZoneForGovernorate(params.storeId, params.governorateName);
    if (!zone) {
      throw new Error(
        `No shipping zone configured for governorate "${params.governorateName}". An admin must map it in Settings.`
      );
    }

    const calc = calculateExchange(
      params.returnedTotalEgp,
      params.replacementTotalEgp,
      zone.exchangeFeeEgp
    );

    return { ...calc, zoneName: zone.zoneName };
  }
}
