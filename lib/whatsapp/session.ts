import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import type { AppUser, Business, Debt, InventoryItem, Loan, Transaction } from "@/types/domain";

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

export async function saveTransaction(txn: Transaction, senderPhone?: string): Promise<void> {
  await getAdminDb().collection(collections.transactions).doc(txn.id).set({
    ...txn,
    createdAt: new Date(txn.createdAt),
    synced: new Date().toISOString(),
    source: "whatsapp",
    ...(senderPhone ? { senderPhone } : {}),
  });

  await Promise.all([
    applyDebtEffect(txn),
    applyInventoryEffect(txn),
    applyLoanEffect(txn),
  ]);
}

// ─── Side-effect: debts ───────────────────────────────────────────────────────

async function applyDebtEffect(txn: Transaction): Promise<void> {
  if (!txn.customerName || (txn.type !== "debt" && txn.type !== "repayment")) return;

  const existing = await findDebt(txn.businessId, txn.customerName);
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
          customerName: txn.customerName,
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

async function applyInventoryEffect(txn: Transaction): Promise<void> {
  if (!txn.productName || !txn.quantity || (txn.type !== "sale" && txn.type !== "stock_purchase")) return;

  const existing = await findInventory(txn.businessId, txn.productName);
  const now = new Date().toISOString();
  const delta = txn.type === "stock_purchase" ? txn.quantity : -txn.quantity;
  const next = existing
    ? { ...existing, quantity: Math.max(0, (existing.quantity ?? 0) + delta), updatedAt: now }
    : {
        id: `stock_${crypto.randomUUID()}`,
        businessId: txn.businessId,
        productName: txn.productName,
        quantity: Math.max(0, delta),
        lowStockThreshold: 5,
        currency: "GHS, Cedis",
        updatedAt: now,
        createdAt: now,
        syncStatus: "synced",
      };

  await getAdminDb().collection(collections.inventory).doc(next.id).set(next, { merge: true });
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
