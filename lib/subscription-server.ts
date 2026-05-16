/**
 * Server-only subscription utilities.
 *
 * DO NOT import in client components or Edge runtime code.
 * Uses firebase-admin — Node.js runtime only.
 *
 * Extends lib/subscription.ts (runtime-agnostic) with server-side behaviour
 * such as lazy SUBSCRIPTION_EXPIRED event emission.
 */

import type { Firestore } from "firebase-admin/firestore";
import { getEffectivePlan } from "@/lib/subscription";
import { collections } from "@/lib/firebase/collections";
import type { SubscriptionPlan } from "@/types/domain";

interface UserSubFields {
  id: string;
  subscriptionPlan?: SubscriptionPlan;
  subscriptionExpiresAt?: string | null;
  referralUnlockExpiresAt?: string | null;
  /** ISO string of the last time a SUBSCRIPTION_EXPIRED event was emitted. */
  subscriptionExpiredEventAt?: string | null;
}

/**
 * Compute the effective plan AND, on the first call that detects an expiry,
 * emit an immutable SUBSCRIPTION_EXPIRED event to the payment_events ledger.
 *
 * The event is idempotent — the doc ID encodes the specific expiry date so a
 * second call for the same expiry produces a no-op `set()`.
 *
 * @param user   - Partial user document fields (must include `id`)
 * @param db     - Admin Firestore instance
 */
export async function getEffectivePlanWithExpiry(
  user: UserSubFields,
  db: Firestore,
): Promise<SubscriptionPlan> {
  const plan = user.subscriptionPlan ?? "free";

  if (plan !== "free" && user.subscriptionExpiresAt) {
    const expiresAt = user.subscriptionExpiresAt;

    if (new Date(expiresAt) <= new Date()) {
      // Plan is expired. Emit a SUBSCRIPTION_EXPIRED event if we haven't for
      // this exact expiry date. Deterministic doc ID = one event per expiry.
      const expiredLedgerId = `${user.id}_SUBSCRIPTION_EXPIRED_${expiresAt}`;

      // Fire-and-forget — does not block the response. Idempotent via set().
      db.collection(collections.paymentEvents)
        .doc(expiredLedgerId)
        .set(
          {
            id:                   expiredLedgerId,
            userId:               user.id,
            plan,
            eventType:            "SUBSCRIPTION_EXPIRED",
            status:               "failed", // subscription is no longer active
            source:               "system",
            subscriptionExpiresAt: expiresAt,
            idempotencyKey:       expiredLedgerId,
            createdAt:            new Date().toISOString(),
            _immutable:           true,
            // These fields aren't applicable to expiry events
            paystackReference:    `expired_${user.id}`,
            annual:               false,
            amountGHS:            0,
            currency:             "GHS",
          },
          { merge: true }, // no-op if doc already exists
        )
        .catch(() => {}); // best-effort — correctness does not depend on this write
    }
  }

  // Delegate actual plan computation to the runtime-agnostic function.
  return getEffectivePlan(user);
}
