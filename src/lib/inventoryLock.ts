import { v4 as uuidv4 } from "uuid";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { logger } from "./logger";

/**
 * Application-level, lease-based lock keyed by Shopify variant id.
 *
 * Per the finalized concurrency decision:
 * - This is the PRIMARY concurrency mechanism (Shopify itself provides no
 *   row-level inventory lock).
 * - The lock must be held across: final Shopify inventory check -> Bosta
 *   Exchange creation -> Shopify inventory deduction.
 * - The lock has a lease (expiresAt) so a crashed/hung process can never
 *   hold it forever. A new request may steal an expired lock.
 *
 * Implementation: a unique constraint on `variantId` in InventoryLock gives
 * us atomic acquire-or-fail semantics via Postgres. We attempt an insert;
 * if it violates the unique constraint we check whether the existing lock
 * has expired, and if so, atomically replace it in a transaction.
 */

export class InventoryLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryLockError";
  }
}

export interface AcquiredLock {
  token: string;
  variantId: string;
  release: () => Promise<void>;
}

export async function acquireInventoryLock(
  variantId: string,
  exchangeRequestId: string,
  leaseMs: number
): Promise<AcquiredLock> {
  const token = uuidv4();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + leaseMs);

  const acquired = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.inventoryLock.findUnique({ where: { variantId } });

    if (existing) {
      const isExpired = existing.expiresAt.getTime() <= now.getTime();
      if (!isExpired) {
        return null; // still actively held by someone else
      }
      // Lease expired: steal the lock.
      return tx.inventoryLock.update({
        where: { variantId },
        data: {
          lockedBy: token,
          exchangeRequestId,
          acquiredAt: now,
          expiresAt,
        },
      });
    }

    return tx.inventoryLock.create({
      data: {
        variantId,
        lockedBy: token,
        exchangeRequestId,
        acquiredAt: now,
        expiresAt,
      },
    });
  });

  if (!acquired) {
    throw new InventoryLockError(
      `Variant ${variantId} is currently being processed by another request. Please try again shortly.`
    );
  }

  logger.info({ variantId, token, exchangeRequestId, expiresAt }, "inventory_lock_acquired");

  return {
    token,
    variantId,
    release: () => releaseInventoryLock(variantId, token),
  };
}

async function releaseInventoryLock(variantId: string, token: string): Promise<void> {
  // Only release if we still own it (defensive: avoids releasing a lock
  // that another process has since legitimately stolen after our lease
  // expired due to an unexpectedly slow critical section).
  const result = await prisma.inventoryLock.deleteMany({
    where: { variantId, lockedBy: token },
  });

  if (result.count === 0) {
    logger.warn(
      { variantId, token },
      "inventory_lock_release_noop_lock_already_expired_or_stolen"
    );
  } else {
    logger.info({ variantId, token }, "inventory_lock_released");
  }
}

/**
 * Convenience wrapper: acquire the lock, run the critical section, always
 * release (even on throw). Callers pass the lease duration from Settings
 * (default INVENTORY_LOCK_LEASE_MS).
 */
export async function withInventoryLock<T>(
  variantId: string,
  exchangeRequestId: string,
  leaseMs: number,
  fn: (lock: AcquiredLock) => Promise<T>
): Promise<T> {
  const lock = await acquireInventoryLock(variantId, exchangeRequestId, leaseMs);
  try {
    return await fn(lock);
  } finally {
    await lock.release();
  }
}
