import axios, { AxiosInstance } from "axios";
import { logger } from "../lib/logger";

/**
 * ShopifyService centralizes ALL Shopify Admin GraphQL API access.
 *
 * Security (Section 39/47):
 * - Access token lives only server-side (loaded from Store.accessToken,
 *   itself stored encrypted at rest by the OAuth layer, never returned to
 *   the frontend, never logged).
 * - Every method here recalculates/re-fetches from Shopify; nothing here
 *   trusts a value that could have come from the browser.
 *
 * NOTE ON API VERSION: pin to a specific, tested Admin API version (set
 * via SHOPIFY_API_VERSION) and bump deliberately after regression testing,
 * rather than tracking "latest" automatically.
 */

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

export interface ShopifyOrderLineItem {
  lineItemId: string;
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  quantity: number;
  price: number;
  compareAtPrice: number | null; // Section 7: presence => Sale Item
}

export interface ShopifyOrderDetails {
  orderId: string;
  orderName: string;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhoneE164: string | null; // as stored on the order/customer record
  lineItems: ShopifyOrderLineItem[];
  fulfillment: {
    trackingNumber: string | null;
    deliveredAt: string | null; // ISO 8601, from Shopify fulfillment event data
  } | null;
  shippingAddress: {
    province: string | null; // governorate
    country: string | null;
  } | null;
}

export interface VariantAvailability {
  variantId: string;
  title: string;
  availableQuantity: number; // at the configured inventory location
  price: number;
  compareAtPrice: number | null;
}

export class ShopifyService {
  private client: AxiosInstance;

  constructor(shopDomain: string, accessToken: string) {
    this.client = axios.create({
      baseURL: `https://${shopDomain}/admin/api/${API_VERSION}`,
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.client.post("/graphql.json", { query, variables });
    if (res.data.errors) {
      logger.error({ errors: res.data.errors }, "shopify_graphql_error");
      throw new Error("Shopify API request failed");
    }
    return res.data.data as T;
  }

  /**
   * Section 3/44: fetch order by name (e.g. "#10452") including line items,
   * fulfillment deliveredAt, and shipping address, WITHOUT exposing this
   * data directly to the frontend until phone verification passes.
   *
   * deliveredAt is read from fulfillment events, per Section 5 ("Use the
   * actual Shopify fulfillment: deliveredAt. Do NOT use creation/payment/
   * shipping date").
   */
  async getOrderByName(orderName: string): Promise<ShopifyOrderDetails | null> {
    const normalizedName = orderName.startsWith("#") ? orderName : `#${orderName}`;

    const query = `
      query FindOrder($query: String!) {
        orders(first: 1, query: $query) {
          edges {
            node {
              id
              name
              phone
              customer { id firstName lastName email phone }
              shippingAddress { province country phone }
              billingAddress { phone }
              lineItems(first: 50) {
                edges {
                  node {
                    id
                    title
                    variantTitle
                    quantity
                    originalUnitPriceSet { shopMoney { amount } }
                    variant {
                      id
                      compareAtPrice
                      product { id }
                    }
                  }
                }
              }
              fulfillments(first: 5) {
                trackingInfo { number }
                events(first: 20) {
                  edges { node { status happenedAt } }
                }
              }
            }
          }
        }
      }
    `;

    const data = await this.graphql<any>(query, { query: `name:${normalizedName}` });
    const node = data.orders.edges[0]?.node;
    if (!node) return null;

    // deliveredAt = timestamp of the fulfillment event whose status is DELIVERED
    let deliveredAt: string | null = null;
    let trackingNumber: string | null = null;
    for (const f of node.fulfillments ?? []) {
      trackingNumber = trackingNumber ?? f.trackingInfo?.[0]?.number ?? null;
      for (const evtEdge of f.events?.edges ?? []) {
        if (evtEdge.node.status === "DELIVERED") {
          deliveredAt = evtEdge.node.happenedAt;
        }
      }
    }

    // Most guest checkouts store the phone only on the shipping/billing
    // address, not on a Customer record, so a customer-only lookup would
    // wrongly reject the real buyer. The number the buyer typed on THIS
    // order (shipping, then order, then billing) is the strongest proof of
    // ownership, so it takes priority over the customer's saved profile.
    const orderPhone: string | null =
      node.shippingAddress?.phone ??
      node.phone ??
      node.billingAddress?.phone ??
      node.customer?.phone ??
      null;

    return {
      orderId: node.id,
      orderName: node.name,
      customerId: node.customer?.id ?? null,
      customerName: node.customer
        ? [node.customer.firstName, node.customer.lastName].filter(Boolean).join(" ")
        : null,
      customerEmail: node.customer?.email ?? null,
      customerPhoneE164: orderPhone,
      lineItems: (node.lineItems?.edges ?? []).map((e: any) => ({
        lineItemId: e.node.id,
        productId: e.node.variant?.product?.id,
        variantId: e.node.variant?.id,
        productTitle: e.node.title,
        variantTitle: e.node.variantTitle,
        quantity: e.node.quantity,
        price: Number(e.node.originalUnitPriceSet.shopMoney.amount),
        compareAtPrice: e.node.variant?.compareAtPrice
          ? Number(e.node.variant.compareAtPrice)
          : null,
      })),
      fulfillment: { trackingNumber, deliveredAt },
      shippingAddress: node.shippingAddress
        ? { province: node.shippingAddress.province, country: node.shippingAddress.country }
        : null,
    };
  }

  /**
   * Section 16/17: current inventory for every variant of a product, at the
   * store's configured inventory location. Used both for the initial
   * "select replacement" UI and the FINAL pre-Bosta check.
   */
  async getVariantAvailability(
    productId: string,
    locationId: string
  ): Promise<VariantAvailability[]> {
    const query = `
      query ProductVariants($id: ID!, $locationId: ID!) {
        product(id: $id) {
          variants(first: 50) {
            edges {
              node {
                id
                title
                price
                compareAtPrice
                inventoryItem {
                  inventoryLevel(locationId: $locationId) {
                    quantities(names: ["available"]) { name quantity }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const data = await this.graphql<any>(query, { id: productId, locationId });
    const edges = data.product?.variants?.edges ?? [];

    return edges.map((e: any) => {
      const availableEntry = e.node.inventoryItem?.inventoryLevel?.quantities?.find(
        (q: any) => q.name === "available"
      );
      return {
        variantId: e.node.id,
        title: e.node.title,
        availableQuantity: availableEntry ? availableEntry.quantity : 0,
        price: Number(e.node.price),
        compareAtPrice: e.node.compareAtPrice ? Number(e.node.compareAtPrice) : null,
      };
    });
  }

  /**
   * Section 26: safe inventory deduction using Shopify's recommended
   * mutation. `inventoryAdjustQuantities` applies a signed delta rather
   * than overwriting an absolute number, which is inherently safer than
   * `inventorySetQuantities` for a decrement operation -- it can't clobber
   * a concurrent change we don't know about. We additionally hold the
   * application-level lock (see inventoryLock.ts) around this call.
   */
  async deductInventory(params: {
    inventoryItemId: string;
    locationId: string;
    delta: number; // negative for deduction
    reason?: string;
  }): Promise<{ success: boolean; newAvailable?: number; rawResponse: unknown }> {
    const mutation = `
      mutation AdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
          inventoryAdjustmentGroup {
            changes { name delta quantityAfterChange }
          }
          userErrors { field message }
        }
      }
    `;

    const input = {
      reason: params.reason ?? "correction",
      name: "available",
      changes: [
        {
          inventoryItemId: params.inventoryItemId,
          locationId: params.locationId,
          delta: params.delta,
        },
      ],
    };

    const data = await this.graphql<any>(mutation, { input });
    const result = data.inventoryAdjustQuantities;

    if (result.userErrors?.length) {
      logger.error({ userErrors: result.userErrors }, "shopify_inventory_adjust_failed");
      return { success: false, rawResponse: result };
    }

    const change = result.inventoryAdjustmentGroup?.changes?.[0];
    return {
      success: true,
      newAvailable: change?.quantityAfterChange,
      rawResponse: result,
    };
  }

  /**
   * Section 17: variant-scoped stock lookup, used for the FINAL pre-Bosta
   * check so we don't have to re-fetch and filter the whole product's
   * variant list inside the locked critical section.
   */
  async getSingleVariantAvailability(
    variantId: string,
    locationId: string
  ): Promise<VariantAvailability | null> {
    const query = `
      query VariantAvailability($id: ID!, $locationId: ID!) {
        productVariant(id: $id) {
          id
          title
          price
          compareAtPrice
          inventoryItem {
            id
            inventoryLevel(locationId: $locationId) {
              quantities(names: ["available"]) { name quantity }
            }
          }
        }
      }
    `;

    const data = await this.graphql<any>(query, { id: variantId, locationId });
    const node = data.productVariant;
    if (!node) return null;

    const availableEntry = node.inventoryItem?.inventoryLevel?.quantities?.find(
      (q: any) => q.name === "available"
    );

    return {
      variantId: node.id,
      title: node.title,
      availableQuantity: availableEntry ? availableEntry.quantity : 0,
      price: Number(node.price),
      compareAtPrice: node.compareAtPrice ? Number(node.compareAtPrice) : null,
    };
  }

  /**
   * Customer-facing product search for the exchange flow ("swap for a
   * different product"). Returns only active, in-stock, non-sale products;
   * per-variant stock and the final price are still re-checked server-side
   * when the exchange is created.
   */
  async searchProducts(
    term: string
  ): Promise<Array<{ productId: string; title: string; imageUrl: string | null; price: number }>> {
    // Keep only letters, digits, spaces and dashes so the search string can't
    // inject extra Shopify search operators.
    const clean = term.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    // Empty search = browse the newest products, like the store's home page.
    const words = clean
      ? clean.split(" ").map((w) => `title:*${w}*`).join(" ")
      : "";
    const query = `
      query SearchProducts($query: String!) {
        products(first: 40, query: $query, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              totalInventory
              featuredImage { url }
              priceRangeV2 { minVariantPrice { amount } }
              compareAtPriceRange { minVariantCompareAtPrice { amount } }
            }
          }
        }
      }
    `;

    const data = await this.graphql<any>(query, { query: `status:active ${words}` });
    return (data.products?.edges ?? [])
      .map((e: any) => e.node)
      .filter((n: any) => {
        const compareAt = Number(n.compareAtPriceRange?.minVariantCompareAtPrice?.amount ?? 0);
        return n.totalInventory > 0 && !(compareAt > 0); // exclude sold-out and sale items
      })
      .slice(0, 18)
      .map((n: any) => ({
        productId: n.id,
        title: n.title,
        imageUrl: n.featuredImage?.url ?? null,
        price: Number(n.priceRangeV2?.minVariantPrice?.amount ?? 0),
      }));
  }

  /** Section 44: fetch active inventory locations for the Settings screen. */
  async listLocations(): Promise<Array<{ id: string; name: string }>> {
    const query = `
      query { locations(first: 50) { edges { node { id name isActive } } } }
    `;
    const data = await this.graphql<any>(query, {});
    return (data.locations.edges ?? [])
      .filter((e: any) => e.node.isActive)
      .map((e: any) => ({ id: e.node.id, name: e.node.name }));
  }
}
