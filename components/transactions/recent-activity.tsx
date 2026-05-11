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
  UserCheck,
  Wallet,
} from "lucide-react";
import type { Transaction, TransactionType } from "@/types/domain";
import { MONEY_IN_TYPES, TRANSACTION_TYPE_LABELS } from "@/types/domain";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/utils";

const ICON_MAP: Record<TransactionType, React.ElementType> = {
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

export function RecentActivity({ transactions }: { transactions: Transaction[] }) {
  if (!transactions.length) {
    return <EmptyState icon={CircleDollarSign} title="Nothing recorded yet" message="Type what happened in your shop — your records will appear here." />;
  }

  return (
    <div className="space-y-3">
      {transactions.slice(0, 10).map((transaction) => {
        const Icon = ICON_MAP[transaction.type] ?? ArrowUpRight;
        const isIn = MONEY_IN_TYPES.includes(transaction.type);
        const colorClass = COLOR_MAP[transaction.type] ?? "text-primary";
        const amountPrefix = isIn ? "+" : transaction.type === "debt" || transaction.type === "transfer" ? "" : "-";

        return (
          <Card key={transaction.id} className="flex items-center gap-3 p-4">
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
          </Card>
        );
      })}
    </div>
  );
}
