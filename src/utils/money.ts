/**
 * All monetary values are handled as integer piastres (EGP * 100) internally
 * to avoid floating point rounding errors, then formatted back to EGP with
 * 2 decimal places at the boundary. Amounts stored in Prisma as Decimal are
 * converted here.
 */

export function toPiastres(egp: number): number {
  return Math.round(egp * 100);
}

export function toEgp(piastres: number): number {
  return Math.round(piastres) / 100;
}

// --------------------------------------------------
// Section 12: REFUND CALCULATION
// FINAL REFUND = TOTAL REFUND PRODUCT VALUE - REFUND_FEE (once per request)
// --------------------------------------------------
export function calculateRefund(productValueEgp: number, refundFeeEgp: number) {
  const productPiastres = toPiastres(productValueEgp);
  const feePiastres = toPiastres(refundFeeEgp);
  const finalPiastres = productPiastres - feePiastres;

  return {
    subtotal: toEgp(productPiastres),
    refundFee: toEgp(feePiastres),
    // A refund can never be pushed below zero by the fee; if product value
    // is less than the fee this is a data/config problem the backend
    // should reject before reaching this calculation, not silently clamp.
    finalRefundAmount: toEgp(finalPiastres),
  };
}

// --------------------------------------------------
// Section 21: EXCHANGE PRICE CALCULATION
//
// priceDifference = replacementTotal - returnedTotal
//
// If priceDifference >= 0 (replacement more expensive or equal):
//   COD = priceDifference + exchangeFee
//
// If priceDifference < 0 (replacement cheaper):
//   let diff = abs(priceDifference)
//   if diff <= exchangeFee:
//        COD = exchangeFee - diff        (customerCredit = 0)
//   if diff > exchangeFee:
//        customerCredit = diff - exchangeFee
//        COD = 0
// --------------------------------------------------
export interface ExchangeCalculation {
  returnedTotal: number;
  replacementTotal: number;
  priceDifference: number; // signed: replacement - returned
  exchangeFee: number;
  customerCredit: number; // > 0 only when FITTEZ owes the customer money
  cod: number; // amount collected on delivery, always >= 0
}

export function calculateExchange(
  returnedTotalEgp: number,
  replacementTotalEgp: number,
  exchangeFeeEgp: number
): ExchangeCalculation {
  const returnedP = toPiastres(returnedTotalEgp);
  const replacementP = toPiastres(replacementTotalEgp);
  const feeP = toPiastres(exchangeFeeEgp);

  const diffP = replacementP - returnedP; // signed

  let codP: number;
  let creditP: number;

  if (diffP >= 0) {
    // Replacement more expensive or exactly equal value.
    codP = diffP + feeP;
    creditP = 0;
  } else {
    const absDiffP = Math.abs(diffP);
    if (absDiffP <= feeP) {
      codP = feeP - absDiffP;
      creditP = 0;
    } else {
      creditP = absDiffP - feeP;
      codP = 0;
    }
  }

  return {
    returnedTotal: toEgp(returnedP),
    replacementTotal: toEgp(replacementP),
    priceDifference: toEgp(diffP),
    exchangeFee: toEgp(feeP),
    customerCredit: toEgp(creditP),
    cod: toEgp(codP),
  };
}
