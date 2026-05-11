"use client";

import { Banknote, ChevronDown, ChevronUp, PiggyBank, Wallet } from "lucide-react";
import { useState } from "react";
import type { Loan } from "@/types/domain";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils";

export function LoanList({ loans }: { loans: Loan[] }) {
  if (!loans.length) {
    return <EmptyState icon={Banknote} title="No loans yet" message='Say "Borrowed 500 from Kofi" or "Gave Ama 200 loan" to track them.' />;
  }

  const taken = loans.filter((l) => l.direction === "taken");
  const given = loans.filter((l) => l.direction === "given");

  return (
    <div className="space-y-6">
      {taken.length > 0 && (
        <section>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-amber-400">You borrowed — you owe these</p>
          <div className="space-y-3">
            {taken.map((loan) => <LoanCard key={loan.id} loan={loan} />)}
          </div>
        </section>
      )}
      {given.length > 0 && (
        <section>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-sky-400">You lent out — they owe you</p>
          <div className="space-y-3">
            {given.map((loan) => <LoanCard key={loan.id} loan={loan} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function LoanCard({ loan }: { loan: Loan }) {
  const [expanded, setExpanded] = useState(false);
  const isTaken = loan.direction === "taken";
  const Icon = isTaken ? PiggyBank : Wallet;
  const progress = loan.originalAmount > 0
    ? Math.round(((loan.originalAmount - loan.outstandingAmount) / loan.originalAmount) * 100)
    : 0;

  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isTaken ? "bg-amber-500/15 text-amber-400" : "bg-sky-500/15 text-sky-400"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold">{loan.counterpartyName ?? (isTaken ? "Unknown person" : "Unknown person")}</p>
            <Badge variant={loan.status === "settled" ? "secondary" : "outline"}>
              {loan.status === "settled" ? "Settled" : "Open"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Started: {formatMoney(loan.originalAmount)} · Still to pay: <span className="font-semibold text-foreground">{formatMoney(loan.outstandingAmount)}</span>
          </p>
          {loan.originalAmount > 0 && (
            <div className="mt-2 h-1.5 w-full rounded-full bg-white/10">
              <div
                className={`h-full rounded-full ${isTaken ? "bg-amber-400" : "bg-sky-400"}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-muted-foreground hover:text-foreground mt-0.5"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {expanded && loan.repaymentHistory.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Payments made</p>
          {loan.repaymentHistory.map((r) => (
            <div key={r.id} className="flex justify-between text-sm">
              <span className="text-muted-foreground">{new Date(r.createdAt).toLocaleDateString("en-GH", { day: "numeric", month: "short" })}</span>
              <span className="font-semibold text-emerald-400">+{formatMoney(r.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
