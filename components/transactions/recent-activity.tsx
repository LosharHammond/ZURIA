"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Building2,
  CircleDollarSign,
  CreditCard,
  HandCoins,
  Landmark,
  PackageMinus,
  PackagePlus,
  PiggyBank,
  RefreshCcw,
  RotateCcw,
  Shuffle,
  Trash2,
  UserCheck,
  Wallet,
} from "lucide-react";
import { memo, useState, type ElementType } from "react";
import type { Transaction, TransactionType } from "@/types/domain";
import { MONEY_IN_TYPES, TRANSACTION_TYPE_LABELS } from "@/types/domain";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/utils";
import { deleteTransaction } from "@/lib/services/transaction-service";
import { useAppStore } from "@/stores/app-store";

const ICON_MAP: Record<TransactionType, ElementType> = {
  sale: ArrowUpRight,
  expense: ArrowDownLeft,
  debt: HandCoins,
  repayment: CircleDollarSign,
  stock_purchase: PackagePlus,
  cost: Building2,
  salary: UserCheck,
  tax: Landmark,
  borrow_in: PiggyBank,
  borrow_out: Wallet,
  loan_repay_out: RotateCcw,
  loan_collect_in: RefreshCcw,
  investment: Banknote,
  withdrawal: PackageMinus,
  refund_out: CreditCard,
  refund_in: PackagePlus,
  transfer: Shuffle,
};

const COLOR_MAP: Partial<Record<TransactionType, string>> = {
  sale: "text-emerald-400",
  repayment: "text-emerald-400",
  loan_collect_in: "text-emerald-400",
  investment: "text-sky-400",
  refund_in: "text-sky-400",
  borrow_in: "text-amber-400",
  expense: "text-rose-400",
  cost: "text-rose-400",
  salary: "text-rose-400",
  tax: "text-rose-400",
  stock_purchase: "text-violet-400",
  borrow_out: "text-amber-400",
  loan_repay_out: "text-orange-400",
  withdrawal: "text-orange-400",
  refund_out: "text-orange-400",
  transfer: "text-slate-400",
  debt: "text-yellow-400",
};

// ─── Single transaction card with inline delete confirmation ─────────────────

function TransactionCard({ transaction }: { transaction: Transaction }) {
  const removeTransaction = useAppStore((s) => s.removeTransaction);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const Icon = ICON_MAP[transaction.type] ?? ArrowUpRight;
  const isIn = MONEY_IN_TYPES.includes(transaction.type);
  const colorClass = COLOR_MAP[transaction.type] ?? "text-primary";
  const amountPrefix = isIn ? "+" : transaction.type === "debt" || transaction.type === "transfer" ? "" : "-";

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteTransaction(transaction.id, transaction);
      removeTransaction(transaction.id);
    } catch (err) {
      console.error("[RecentActivity] delete failed:", err);
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (confirmDelete) {
    return (
      <Card className="flex flex-col gap-3 p-4">
        <p className="text-sm font-semibold">Delete this entry?</p>
        <p className="text-xs text-muted-foreground leading-4">
          <span className="font-medium text-foreground">
            {TRANSACTION_TYPE_LABELS[transaction.type] ?? transaction.type.replace(/_/g, " ")}
            {" · "}{formatMoney(transaction.amount)}
          </span>
          {" "}&mdash; {transaction.notes || transaction.productName || transaction.rawText || "entry"}.
          {(transaction.type === "debt" || transaction.type === "repayment") && (
            <> Debt balance will be reversed automatically.</>
          )}
          {(transaction.type === "sale" || transaction.type === "stock_purchase") && transaction.quantity && (
            <> Inventory count will be reversed automatically.</>
          )}
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex-1 rounded-xl bg-destructive/15 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/25 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Yes, delete"}
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            disabled={deleting}
            className="flex-1 rounded-xl bg-white/[0.06] py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-white/[0.12] disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex items-center gap-3 p-4">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 ${colorClass}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {transaction.notes || transaction.productName || transaction.rawText || "Transaction"}
        </p>
        <p className="text-xs capitalize text-muted-foreground">
          {TRANSACTION_TYPE_LABELS[transaction.type] ?? transaction.type.replace(/_/g, " ")}
          {transaction.customerName && ` · ${transaction.customerName}`}
        </p>
      </div>
      <p className={`shrink-0 font-bold ${colorClass}`}>
        {amountPrefix}{formatMoney(transaction.amount)}
      </p>
      <button
        onClick={() => setConfirmDelete(true)}
        aria-label="Delete entry"
        className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </Card>
  );
}

// ─── List ─────────────────────────────────────────────────────────────────────

export const RecentActivity = memo(function RecentActivity({ transactions }: { transactions: Transaction[] }) {
  if (!transactions.length) {
    return <EmptyState icon={CircleDollarSign} title="Nothing recorded yet" message="Type what happened in your shop — your records will appear here." />;
  }

  return (
    <div className="space-y-3">
      {transactions.slice(0, 20).map((transaction) => (
        <TransactionCard key={transaction.id} transaction={transaction} />
      ))}
    </div>
  );
});
