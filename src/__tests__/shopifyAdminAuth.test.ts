jest.mock("../lib/db", () => require("./__mocks__/db"));
jest.mock("../lib/shopifyApiClient", () => ({
  shopifyApiClient: {
    session: {
      decodeSessionToken: jest.fn(),
    },
  },
}));

import { prisma } from "../lib/db";
import { shopifyApiClient } from "../lib/shopifyApiClient";
import { shopifyAdminAuth } from "../middleware/shopifyAuth";
import { requireAdmin } from "../middleware/requireAdmin";

function makeReqRes(headers: Record<string, string> = {}) {
  const req: any = {
    header: (name: string) => headers[name.toLowerCase()],
    log: { warn: jest.fn(), error: jest.fn() },
  };
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return { req, res };
}

describe("shopifyAdminAuth (App Bridge ID token verification)", () => {
  beforeEach(() => {
    (prisma as any).__reset();
    (shopifyApiClient.session.decodeSessionToken as jest.Mock).mockReset();
  });

  it("rejects a request with no Authorization header", async () => {
    const { req, res } = makeReqRes();
    const next = jest.fn();

    await shopifyAdminAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(shopifyApiClient.session.decodeSessionToken).not.toHaveBeenCalled();
  });

  it("rejects a header that isn't a Bearer token", async () => {
    const { req, res } = makeReqRes({ authorization: "Basic abc123" });
    const next = jest.fn();

    await shopifyAdminAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects when decodeSessionToken throws (invalid/expired/wrong signature)", async () => {
    (shopifyApiClient.session.decodeSessionToken as jest.Mock).mockRejectedValue(
      new Error("Invalid signature")
    );
    const { req, res } = makeReqRes({ authorization: "Bearer bad.token.here" });
    const next = jest.fn();

    await shopifyAdminAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a validly-signed token for a shop with no matching Store row", async () => {
    (shopifyApiClient.session.decodeSessionToken as jest.Mock).mockResolvedValue({
      dest: "https://unknown-shop.myshopify.com",
      sub: "staff_1",
    });
    const { req, res } = makeReqRes({ authorization: "Bearer valid.but.unknown.shop" });
    const next = jest.fn();

    await shopifyAdminAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a valid token for a known, active store and populates req context", async () => {
    (prisma as any).store = {
      findUnique: jest.fn(async () => ({
        id: "store_1",
        shopDomain: "fittez.myshopify.com",
        accessToken: "static-custom-app-token",
        isActive: true,
      })),
    };

    (shopifyApiClient.session.decodeSessionToken as jest.Mock).mockResolvedValue({
      dest: "https://fittez.myshopify.com",
      sub: "staff_42",
    });

    const { req, res } = makeReqRes({ authorization: "Bearer valid.token.here" });
    const next = jest.fn();

    await shopifyAdminAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.storeId).toBe("store_1");
    expect(req.shopDomain).toBe("fittez.myshopify.com");
    expect(req.shopifyAccessToken).toBe("static-custom-app-token");
    expect(req.isAdmin).toBe(true);
    expect(req.adminId).toBe("staff_42");
  });

  it("normalizes the dest URL (strips protocol) before the Store lookup", async () => {
    const findUnique = jest.fn(async () => ({
      id: "store_1",
      shopDomain: "fittez.myshopify.com",
      accessToken: "tok",
      isActive: true,
    }));
    (prisma as any).store = { findUnique };

    (shopifyApiClient.session.decodeSessionToken as jest.Mock).mockResolvedValue({
      dest: "https://fittez.myshopify.com",
      sub: "staff_1",
    });

    const { req, res } = makeReqRes({ authorization: "Bearer x" });
    await shopifyAdminAuth(req, res, jest.fn());

    expect(findUnique).toHaveBeenCalledWith({ where: { shopDomain: "fittez.myshopify.com" } });
  });
});

describe("requireAdmin (post-shopifyAdminAuth guard)", () => {
  it("passes through when shopifyAdminAuth already populated req context", () => {
    const req: any = { storeId: "s1", shopDomain: "fittez.myshopify.com", isAdmin: true };
    const { res } = makeReqRes();
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects when req context is missing (shopifyAdminAuth wasn't run or failed)", () => {
    const req: any = {};
    const { res } = makeReqRes();
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
