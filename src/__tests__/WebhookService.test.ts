jest.mock("../lib/db", () => require("./__mocks__/db"));

import {
  mapBostaStateToExchangeStatus,
  BOSTA_EXCHANGE_STATE_CODES,
} from "../services/WebhookService";

describe("mapBostaStateToExchangeStatus (verified numeric state codes)", () => {
  it("maps state 46 (Returned to business) for EXCHANGE type", () => {
    expect(
      mapBostaStateToExchangeStatus(BOSTA_EXCHANGE_STATE_CODES.RETURNED_TO_BUSINESS, "EXCHANGE")
    ).toBe("RETURNED_TO_BUSINESS");
  });

  it("maps state 22 (picking up from consignee / out for exchange) for EXCHANGE type", () => {
    expect(
      mapBostaStateToExchangeStatus(
        BOSTA_EXCHANGE_STATE_CODES.PICKING_UP_FROM_CONSIGNEE,
        "EXCHANGE"
      )
    ).toBe("RETURN_IN_PROGRESS");
  });

  it("maps failure-like codes (47/48/49/100/101) to FAILED for EXCHANGE type", () => {
    expect(mapBostaStateToExchangeStatus(47, "EXCHANGE")).toBe("FAILED"); // Exception
    expect(mapBostaStateToExchangeStatus(48, "EXCHANGE")).toBe("FAILED"); // Terminated
    expect(mapBostaStateToExchangeStatus(49, "EXCHANGE")).toBe("FAILED"); // Canceled
    expect(mapBostaStateToExchangeStatus(100, "EXCHANGE")).toBe("FAILED"); // Lost
    expect(mapBostaStateToExchangeStatus(101, "EXCHANGE")).toBe("FAILED"); // Damaged
  });

  it("does NOT apply the Exchange mapping when type is not EXCHANGE", () => {
    // Same numeric code (46) means something different for other types in
    // principle -- and even where it wouldn't, we must not apply Exchange
    // semantics to a non-Exchange webhook.
    expect(mapBostaStateToExchangeStatus(46, "SEND")).toBeNull();
    expect(mapBostaStateToExchangeStatus(46, "CUSTOMER_RETURN_PICKUP")).toBeNull();
    expect(mapBostaStateToExchangeStatus(46, undefined)).toBeNull();
  });

  it("returns undefined (not null) for a recognized-but-unmapped EXCHANGE code", () => {
    // 102/103/104/105 are real codes but intentionally don't drive our
    // ExchangeStatus workflow -- distinguish this from the type mismatch
    // case, which returns null.
    expect(mapBostaStateToExchangeStatus(102, "EXCHANGE")).toBeUndefined();
    expect(mapBostaStateToExchangeStatus(103, "EXCHANGE")).toBeUndefined();
  });

  it("uses the exact verified numeric codes, not invented string keys", () => {
    expect(BOSTA_EXCHANGE_STATE_CODES.RETURNED_TO_BUSINESS).toBe(46);
    expect(BOSTA_EXCHANGE_STATE_CODES.PICKING_UP_FROM_CONSIGNEE).toBe(22);
    expect(BOSTA_EXCHANGE_STATE_CODES.PICKED_UP_FROM_CONSIGNEE).toBe(23);
    expect(BOSTA_EXCHANGE_STATE_CODES.EXCEPTION).toBe(47);
    expect(BOSTA_EXCHANGE_STATE_CODES.TERMINATED).toBe(48);
    expect(BOSTA_EXCHANGE_STATE_CODES.CANCELED).toBe(49);
  });
});
