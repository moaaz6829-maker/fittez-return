// Manual mock of the Prisma client singleton, covering only the surface
// ExchangeService/InventoryService actually touch. Each test overrides the
// specific method behaviors it needs via mockImplementation/mockResolvedValue.

const state: { exchangeRequests: Map<string, any>; bostaShipments: Map<string, any> } = {
  exchangeRequests: new Map(),
  bostaShipments: new Map(),
};

function resetState() {
  state.exchangeRequests.clear();
  state.bostaShipments.clear();
}

export const prisma: any = {
  __state: state,
  __reset: resetState,

  exchangeRequest: {
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.idempotencyKey) {
        return (
          [...state.exchangeRequests.values()].find(
            (r) => r.idempotencyKey === where.idempotencyKey
          ) ?? null
        );
      }
      if (where.id) return state.exchangeRequests.get(where.id) ?? null;
      return null;
    }),
    findUniqueOrThrow: jest.fn(async ({ where }: any) => {
      const found = state.exchangeRequests.get(where.id);
      if (!found) throw new Error("not found");
      return found;
    }),
    create: jest.fn(async ({ data }: any) => {
      const id = `exreq_${state.exchangeRequests.size + 1}`;
      const record = { id, items: data.items?.create ?? [], ...data };
      state.exchangeRequests.set(id, record);
      return record;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const existing = state.exchangeRequests.get(where.id);
      const updated = { ...existing, ...data };
      state.exchangeRequests.set(where.id, updated);
      return updated;
    }),
  },

  bostaShipment: {
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.exchangeRequestId) {
        return (
          [...state.bostaShipments.values()].find(
            (s) => s.exchangeRequestId === where.exchangeRequestId
          ) ?? null
        );
      }
      return null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const id = `shipment_${state.bostaShipments.size + 1}`;
      const record = { id, ...data };
      state.bostaShipments.set(id, record);
      return record;
    }),
  },

  inventoryLock: {
    findUnique: jest.fn(async () => null),
    create: jest.fn(async ({ data }: any) => ({ id: "lock_1", ...data })),
    update: jest.fn(async ({ data }: any) => ({ id: "lock_1", ...data })),
    deleteMany: jest.fn(async () => ({ count: 1 })),
  },

  refundItem: {
    findMany: jest.fn(async () => []),
  },
  exchangeItem: {
    findMany: jest.fn(async () => []),
  },
  inventoryTransaction: {
    create: jest.fn(async ({ data }: any) => ({ id: "tx_1", ...data })),
  },

  store: {
    findUnique: jest.fn(async () => null),
  },

  $transaction: jest.fn(async (fn: any) => fn(prisma)),
};
