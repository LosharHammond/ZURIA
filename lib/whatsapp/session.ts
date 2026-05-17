import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import type { AppUser, Business, Debt, InventoryItem, Loan, SubscriptionPlan, Transaction } from "@/types/domain";
import { sendText } from "@/lib/whatsapp/client";

// ─── User lookup ──────────────────────────────────────────────────────────────

export async function getUserByPhone(normalizedPhone: string): Promise<{ user: AppUser; business: Business; pin: string | null } | null> {
  const snap = await getAdminDb()
    .collection(collections.users)
    .where("phoneNumber", "==", normalizedPhone)
    .limit(1)
    .get();

  const docSnap = snap.docs[0];
  if (!docSnap || !docSnap.data().businessId) return null;

  const userData = docSnap.data();
  const user = userData as AppUser;
  const pin = (userData.whatsappPin as string | undefined) ?? null;

  const bizDoc = await getAdminDb().collection(collections.businesses).doc(user.businessId!).get();
  if (!bizDoc.exists) return null;

  return { user, business: bizDoc.data() as Business, pin };
}

// ─── Subscription helpers ─────────────────────────────────────────────────────

/**
 * Returns the effective subscription plan.
 *
 * Priority order:
 * 1. Active paid plan (subscriptionPlan + valid subscriptionExpiresAt)
 * 2. Referral milestone unlock — free users who referred 30+ people this month
 *    get Growth features until end of that month (referralUnlockExpiresAt)
 * 3. "free" fallback
 */
export function getEffectivePlan(user: AppUser): SubscriptionPlan {
  const plan = user.subscriptionPlan ?? "free";
  const now = new Date();

  // 1. Check if a paid plan is still active
  if (plan !== "free") {
    const expiresAt = user.subscriptionExpiresAt;
    if (!expiresAt || new Date(expiresAt) > now) {
      return plan; // paid plan still valid
    }
    // Paid plan expired — fall through to check referral unlock
  }

  // 2. Check referral milestone unlock (30 referrals this month → Growth)
  const unlockExpiry = user.referralUnlockExpiresAt;
  if (unlockExpiry && new Date(unlockExpiry) > now) {
    return "growth";
  }

  return "free";
}

/**
 * Returns the current reset period key for a plan:
 *  free   → "YYYY-MM-DD"  (daily reset)
 *  growth → "YYYY-MM"     (monthly reset)
 *  pro / enterprise → null (unlimited — no counting)
 */
function currentResetKey(plan: SubscriptionPlan): string | null {
  const now = new Date().toISOString();
  if (plan === "free")   return now.slice(0, 10); // daily
  if (plan === "growth") return now.slice(0, 7);  // monthly
  return null;
}

/**
 * Returns how many messages the user has sent in the current period,
 * automatically resetting the counter if the period has rolled over.
 * Returns 0 if the plan has no limit (pro / enterprise).
 */
export async function getAndMaybeResetMessageCount(user: AppUser, plan: SubscriptionPlan): Promise<number> {
  const resetKey = currentResetKey(plan);
  if (!resetKey) return 0; // unlimited plan — never blocked

  const db = getAdminDb();
  const userRef = db.collection(collections.users).doc(user.id);

  if ((user.whatsappMessageResetKey ?? "") !== resetKey) {
    // New period — reset count
    await userRef.update({
      whatsappMessageCount: 0,
      whatsappMessageResetKey: resetKey,
      updatedAt: new Date().toISOString(),
    });
    return 0;
  }

  return (user.whatsappMessageCount ?? 0);
}

/**
 * Atomically increments the user's WhatsApp message counter.
 * Also stamps the reset key so the period is always current.
 */
export async function incrementMessageCount(userId: string, plan: SubscriptionPlan): Promise<void> {
  const resetKey = currentResetKey(plan);
  if (!resetKey) return; // unlimited — nothing to track
  await getAdminDb().collection(collections.users).doc(userId).update({
    whatsappMessageCount: FieldValue.increment(1),
    whatsappMessageResetKey: resetKey,
    updatedAt: new Date().toISOString(),
  });
}

// ─── Read operations ──────────────────────────────────────────────────────────

export async function getTodayTransactions(businessId: string): Promise<Transaction[]> {
  const today = new Date().toISOString().slice(0, 10);
  const snap = await getAdminDb()
    .collection(collections.transactions)
    .where("businessId", "==", businessId)
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();

  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? data.createdAt,
      } as Transaction;
    })
    .filter((t) => t.createdAt.startsWith(today));
}

/**
 * Returns today's AND yesterday's transactions so the end-of-day report can
 * show a "vs yesterday" comparison without a second Firestore round-trip.
 */
export async function getTodayAndYesterdayTransactions(businessId: string): Promise<Transaction[]> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);

  const snap = await getAdminDb()
    .collection(collections.transactions)
    .where("businessId", "==", businessId)
    .orderBy("createdAt", "desc")
    .limit(500)
    .get();

  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? data.createdAt,
      } as Transaction;
    })
    .filter((t) => {
      const day = t.createdAt.slice(0, 10);
      return day === today || day === yesterday;
    });
}

export async function getWeekTransactions(businessId: string): Promise<Transaction[]> {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - daysFromMonday);
  weekStart.setHours(0, 0, 0, 0);

  const snap = await getAdminDb()
    .collection(collections.transactions)
    .where("businessId", "==", businessId)
    .orderBy("createdAt", "desc")
    .limit(500)
    .get();

  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? data.createdAt,
      } as Transaction;
    })
    .filter((t) => t.createdAt.slice(0, 10) >= weekStart.toISOString().slice(0, 10));
}

export async function getMonthTransactions(businessId: string): Promise<Transaction[]> {
  const thisMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"

  const snap = await getAdminDb()
    .collection(collections.transactions)
    .where("businessId", "==", businessId)
    .orderBy("createdAt", "desc")
    .limit(1000)
    .get();

  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? data.createdAt,
      } as Transaction;
    })
    .filter((t) => t.createdAt.startsWith(thisMonth));
}

export async function getAllTransactions(businessId: string, max = 100): Promise<Transaction[]> {
  const snap = await getAdminDb()
    .collection(collections.transactions)
    .where("businessId", "==", businessId)
    .orderBy("createdAt", "desc")
    .limit(max)
    .get();

  return snap.docs.map((d) => {
    const data = d.data();
    return {
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() ?? data.createdAt,
    } as Transaction;
  });
}

export async function getOpenDebts(businessId: string): Promise<Debt[]> {
  const snap = await getAdminDb()
    .collection(collections.debts)
    .where("businessId", "==", businessId)
    .where("status", "==", "open")
    .orderBy("outstandingAmount", "desc")
    .get();

  return snap.docs.map((d) => d.data() as Debt);
}

export async function getLoans(businessId: string): Promise<Loan[]> {
  const snap = await getAdminDb()
    .collection(collections.loans)
    .where("businessId", "==", businessId)
    .where("status", "==", "open")
    .get();

  return snap.docs.map((d) => d.data() as Loan);
}

export async function getInventory(businessId: string): Promise<InventoryItem[]> {
  const snap = await getAdminDb()
    .collection(collections.inventory)
    .where("businessId", "==", businessId)
    .orderBy("productName")
    .get();

  return snap.docs.map((d) => d.data() as InventoryItem);
}

// ─── Write operations ─────────────────────────────────────────────────────────

/**
 * Soft-delete a transaction by marking it voided.
 * Voided transactions are excluded from reports and balance calculations.
 * An audit trail is preserved — the record is never physically deleted.
 *
 * Returns `true` if the transaction was found and voided, `false` if not found.
 */
export async function voidTransaction(
  transactionId: string,
  reason: "user_undo" | "duplicate" | "correction" = "user_undo",
): Promise<boolean> {
  const db  = getAdminDb();
  const ref = db.collection(collections.transactions).doc(transactionId);
  const doc = await ref.get();

  if (!doc.exists) return false;

  await ref.update({
    deleted:       true,
    deletedAt:     new Date().toISOString(),
    deletedReason: reason,
    syncStatus:    "synced",
  });

  return true;
}

// ─── Side-effect reversal helpers ─────────────────────────────────────────────

/**
 * Reverse all side effects that were applied when a transaction was originally saved.
 * Called before marking a transaction as voided so that debts, inventory, and loans
 * remain accurate after an undo.
 *
 * Uses Promise.allSettled so a failure in one reversal doesn't prevent the others.
 */
async function reverseTransactionEffects(txn: Transaction): Promise<{
  hasDebtEffect:      boolean;
  hasInventoryEffect: boolean;
  hasLoanEffect:      boolean;
}> {
  const [debtRes, invRes, loanRes] = await Promise.allSettled([
    reverseDebtEffect(txn),
    reverseInventoryEffect(txn),
    reverseLoanEffect(txn),
  ]);

  return {
    hasDebtEffect:      debtRes.status      === "fulfilled" && debtRes.value,
    hasInventoryEffect: invRes.status        === "fulfilled" && invRes.value,
    hasLoanEffect:      loanRes.status       === "fulfilled" && loanRes.value,
  };
}

async function reverseDebtEffect(txn: Transaction): Promise<boolean> {
  if (!txn.customerName || (txn.type !== "debt" && txn.type !== "repayment")) return false;

  const normalizedName = txn.customerName.trim().toLowerCase();
  const existing = await findDebt(txn.businessId, normalizedName);
  if (!existing) return false;

  const now = new Date().toISOString();

  if (txn.type === "debt") {
    // Reverse: subtract the amount that was added when the debt was created
    const newOriginal    = Math.max(0, existing.originalAmount    - txn.amount);
    const newOutstanding = Math.max(0, existing.outstandingAmount - txn.amount);
    await getAdminDb().collection(collections.debts).doc(existing.id).update({
      originalAmount:    newOriginal,
      outstandingAmount: newOutstanding,
      status:            newOutstanding === 0 ? "paid" : "open",
      lastActivityAt:    now,
    });
    return true;
  }

  if (txn.type === "repayment") {
    // Reverse: add back the amount that was subtracted when the repayment was recorded.
    // Also remove the repayment entry that referenced this transaction from history.
    const newOutstanding = existing.outstandingAmount + txn.amount;
    const cleanHistory   = (existing.repaymentHistory ?? []).filter(
      (r: { transactionId?: string }) => r.transactionId !== txn.id,
    );
    await getAdminDb().collection(collections.debts).doc(existing.id).update({
      outstandingAmount: newOutstanding,
      repaymentHistory:  cleanHistory,
      status:            "open",
      lastActivityAt:    now,
    });
    return true;
  }

  return false;
}

async function reverseInventoryEffect(txn: Transaction): Promise<boolean> {
  if (!txn.productName || txn.quantity == null || txn.quantity === 0) return false;
  if (txn.type !== "sale" && txn.type !== "stock_purchase") return false;

  const existing = await findInventory(txn.businessId, txn.productName);
  if (!existing) return false;

  // sale reversed: add quantity back. stock_purchase reversed: subtract quantity.
  const txnQty = txn.quantity; // narrowed: not null/undefined after check above
  const delta  = txn.type === "sale" ? txnQty : -txnQty;
  const curQty = existing.quantity ?? 0;
  const newQty = Math.max(0, curQty + delta);

  await getAdminDb().collection(collections.inventory).doc(existing.id).update({
    quantity:  newQty,
    updatedAt: new Date().toISOString(),
  });
  return true;
}

async function reverseLoanEffect(txn: Transaction): Promise<boolean> {
  const now = new Date().toISOString();

  if (txn.type === "borrow_in" || txn.type === "borrow_out") {
    const direction = txn.type === "borrow_in" ? "taken" : "given";
    const existing  = await findLoan(txn.businessId, direction, txn.customerName ?? null);
    if (!existing) return false;

    const newOutstanding = Math.max(0, existing.outstandingAmount - txn.amount);
    const newOriginal    = Math.max(0, existing.originalAmount    - txn.amount);
    await getAdminDb().collection(collections.loans).doc(existing.id).update({
      originalAmount:    newOriginal,
      outstandingAmount: newOutstanding,
      status:            newOutstanding === 0 ? "settled" : "open",
      lastActivityAt:    now,
    });
    return true;
  }

  if (txn.type === "loan_repay_out" || txn.type === "loan_collect_in") {
    const direction = txn.type === "loan_repay_out" ? "taken" : "given";
    const existing  = await findOpenLoan(txn.businessId, direction, txn.customerName ?? null);
    if (!existing) return false;

    // Remove the repayment entry and add the amount back to outstanding
    const newOutstanding = existing.outstandingAmount + txn.amount;
    const cleanHistory   = (existing.repaymentHistory ?? []).filter(
      (r: { transactionId?: string }) => r.transactionId !== txn.id,
    );
    await getAdminDb().collection(collections.loans).doc(existing.id).update({
      outstandingAmount: newOutstanding,
      repaymentHistory:  cleanHistory,
      status:            "open",
      lastActivityAt:    now,
    });
    return true;
  }

  return false;
}

// ─── Void with full side-effect reversal ─────────────────────────────────────

export interface VoidResult {
  success:            boolean;
  txnType?:           string;
  hasDebtEffect:      boolean;
  hasInventoryEffect: boolean;
  hasLoanEffect:      boolean;
}

/**
 * Soft-delete a transaction AND reverse all side effects (debt, inventory, loan).
 *
 * This is the correct function to call from the undo flow. Unlike `voidTransaction()`
 * (which only marks the transaction as deleted), this function ensures Firestore
 * remains internally consistent: debt balances, stock counts, and loan balances
 * are all reverted to their pre-transaction state.
 */
export async function voidTransactionWithSideEffects(
  transactionId: string,
): Promise<VoidResult> {
  const db  = getAdminDb();
  const ref = db.collection(collections.transactions).doc(transactionId);
  const doc = await ref.get();

  if (!doc.exists) {
    return { success: false, hasDebtEffect: false, hasInventoryEffect: false, hasLoanEffect: false };
  }

  const txn = {
    ...doc.data(),
    // Normalise Firestore Timestamp → ISO string if needed
    createdAt: doc.data()!.createdAt?.toDate?.()?.toISOString() ?? doc.data()!.createdAt,
  } as Transaction;

  // Step 1: reverse all side effects first (so we have consistent state)
  const effects = await reverseTransactionEffects(txn);

  // Step 2: soft-delete the transaction record
  await ref.update({
    deleted:       true,
    deletedAt:     new Date().toISOString(),
    deletedReason: "user_undo",
    syncStatus:    "synced",
  });

  return {
    success: true,
    txnType: txn.type,
    ...effects,
  };
}

export async function saveTransaction(txn: Transaction, senderPhone?: string): Promise<void> {
  await getAdminDb().collection(collections.transactions).doc(txn.id).set({
    ...txn,
    createdAt: new Date(txn.createdAt),
    synced: new Date().toISOString(),
    source: "manual",   // WhatsApp voice/text entries are classified as manual input
    ...(senderPhone ? { senderPhone } : {}),
  });

  await Promise.all([
    applyDebtEffect(txn),
    applyInventoryEffect(txn, senderPhone),
    applyLoanEffect(txn),
  ]);
}

// ─── Side-effect: debts ───────────────────────────────────────────────────────

async function applyDebtEffect(txn: Transaction): Promise<void> {
  if (!txn.customerName || (txn.type !== "debt" && txn.type !== "repayment")) return;

  // Normalize name to prevent duplicate records for "Ama" vs "ama" vs " Ama "
  const normalizedName = txn.customerName.trim().toLowerCase();
  const existing = await findDebt(txn.businessId, normalizedName);
  const now = new Date().toISOString();

  if (txn.type === "debt") {
    const next = existing
      ? {
          ...existing,
          originalAmount: existing.originalAmount + txn.amount,
          outstandingAmount: existing.outstandingAmount + txn.amount,
          status: "open",
          lastActivityAt: now,
        }
      : {
          id: `debt_${crypto.randomUUID()}`,
          businessId: txn.businessId,
          customerName: normalizedName,
          originalAmount: txn.amount,
          outstandingAmount: txn.amount,
          repaymentHistory: [],
          status: "open",
          currency: "GHS, Cedis",
          lastActivityAt: now,
          createdAt: now,
          syncStatus: "synced",
        };
    await getAdminDb().collection(collections.debts).doc(next.id).set(next, { merge: true });
  }

  if (txn.type === "repayment" && existing) {
    const outstanding = Math.max(0, existing.outstandingAmount - txn.amount);
    const repayment = { id: `repay_${crypto.randomUUID()}`, amount: txn.amount, currency: "GHS, Cedis", createdAt: now, transactionId: txn.id };
    await getAdminDb().collection(collections.debts).doc(existing.id).update({
      outstandingAmount: outstanding,
      repaymentHistory: [...(existing.repaymentHistory ?? []), repayment],
      status: outstanding === 0 ? "paid" : "open",
      lastActivityAt: now,
    });
  }
}

async function findDebt(businessId: string, customerName: string): Promise<Debt | null> {
  const snap = await getAdminDb()
    .collection(collections.debts)
    .where("businessId", "==", businessId)
    .where("customerName", "==", customerName)
    .limit(1)
    .get();
  return snap.docs[0]?.data() as Debt ?? null;
}

// ─── Side-effect: inventory ───────────────────────────────────────────────────

async function applyInventoryEffect(txn: Transaction, ownerPhone?: string): Promise<void> {
  if (!txn.productName || !txn.quantity || (txn.type !== "sale" && txn.type !== "stock_purchase")) return;

  const existing = await findInventory(txn.businessId, txn.productName);
  const now = new Date().toISOString();
  const delta = txn.type === "stock_purchase" ? txn.quantity : -txn.quantity;
  const newQty = Math.max(0, (existing?.quantity ?? 0) + delta);
  const threshold = existing?.lowStockThreshold ?? 5;

  const next = existing
    ? { ...existing, quantity: newQty, updatedAt: now }
    : {
        id: `stock_${crypto.randomUUID()}`,
        businessId: txn.businessId,
        productName: txn.productName,
        quantity: newQty,
        lowStockThreshold: 5,
        currency: "GHS, Cedis",
        updatedAt: now,
        createdAt: now,
        syncStatus: "synced",
      };

  await getAdminDb().collection(collections.inventory).doc(next.id).set(next, { merge: true });

  // ── Low-stock alert ── fire-and-forget WhatsApp notification ────────────────
  // Only alert when a *sale* brings stock *below or at* the threshold for the
  // first time (i.e., previous qty was above threshold).
  const prevQty = existing?.quantity ?? 0;
  const wasAbove = prevQty > threshold;
  const isNowAtOrBelow = newQty <= threshold;

  if (txn.type === "sale" && wasAbove && isNowAtOrBelow && ownerPhone) {
    const alert = [
      `⚠️ *Low stock alert!*`,
      ``,
      `*${txn.productName}* is running low — only *${newQty}* left.`,
      ``,
      `_Restock soon to avoid running out! Reply "stock" to see your full inventory._`,
    ].join("\n");

    // Non-blocking — don't let a notification failure break the transaction save
    sendText(`whatsapp:${ownerPhone}`, alert).catch(() => {});
  }
}

async function findInventory(businessId: string, productName: string) {
  const snap = await getAdminDb()
    .collection(collections.inventory)
    .where("businessId", "==", businessId)
    .where("productName", "==", productName)
    .limit(1)
    .get();
  return snap.docs[0]?.data() as InventoryItem ?? null;
}

// ─── Side-effect: loans ───────────────────────────────────────────────────────

async function applyLoanEffect(txn: Transaction): Promise<void> {
  const now = new Date().toISOString();
  const counterparty = txn.customerName;

  if (txn.type === "borrow_in" || txn.type === "borrow_out") {
    const direction = txn.type === "borrow_in" ? "taken" : "given";
    const existing = await findLoan(txn.businessId, direction, counterparty);
    const next = existing
      ? {
          ...existing,
          originalAmount: existing.originalAmount + txn.amount,
          outstandingAmount: existing.outstandingAmount + txn.amount,
          status: "open",
          lastActivityAt: now,
        }
      : {
          id: `loan_${crypto.randomUUID()}`,
          businessId: txn.businessId,
          direction,
          counterpartyName: counterparty,
          originalAmount: txn.amount,
          outstandingAmount: txn.amount,
          repaymentHistory: [],
          status: "open",
          currency: "GHS, Cedis",
          notes: txn.rawText,
          lastActivityAt: now,
          createdAt: now,
          syncStatus: "synced",
        };
    await getAdminDb().collection(collections.loans).doc(next.id).set(next, { merge: true });
  }

  if (txn.type === "loan_repay_out" || txn.type === "loan_collect_in") {
    const direction = txn.type === "loan_repay_out" ? "taken" : "given";
    const existing = await findOpenLoan(txn.businessId, direction, counterparty);
    if (existing) {
      const repayment = { id: `lrepay_${crypto.randomUUID()}`, amount: txn.amount, createdAt: now, transactionId: txn.id };
      const outstanding = Math.max(0, existing.outstandingAmount - txn.amount);
      await getAdminDb().collection(collections.loans).doc(existing.id).update({
        outstandingAmount: outstanding,
        repaymentHistory: [...(existing.repaymentHistory ?? []), repayment],
        status: outstanding === 0 ? "settled" : "open",
        lastActivityAt: now,
      });
    }
  }
}

async function findLoan(businessId: string, direction: string, counterpartyName: string | null) {
  const base = getAdminDb().collection(collections.loans)
    .where("businessId", "==", businessId)
    .where("direction", "==", direction);
  const q = counterpartyName
    ? base.where("counterpartyName", "==", counterpartyName)
    : base;
  const snap = await q.limit(1).get();
  return snap.docs[0]?.data() as Loan ?? null;
}

async function findOpenLoan(businessId: string, direction: string, counterpartyName: string | null) {
  const base = getAdminDb().collection(collections.loans)
    .where("businessId", "==", businessId)
    .where("direction", "==", direction)
    .where("status", "==", "open");
  const q = counterpartyName
    ? base.where("counterpartyName", "==", counterpartyName)
    : base;
  const snap = await q.limit(1).get();
  return snap.docs[0]?.data() as Loan ?? null;
}
