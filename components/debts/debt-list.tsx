"use client";

import { formatDistanceToNow } from "date-fns";
import { HandCoins } from "lucide-react";
import type { Debt } from "@/types/domain";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { formatMoney } from "@/lib/utils";

function safeDistance(value: string | number | undefined): string {
  try {
    const d = new Date(value as string);
    if (isNaN(d.getTime())) return "some time ago";
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return "some time ago";
  }
}

export function DebtList({ debts }: { debts: Debt[] }) {
  const open = debts
    .filter((debt) => debt.outstandingAmount > 0)
    .sort((a, b) => b.outstandingAmount - a.outstandingAmount);
  if (!open.length) return <EmptyState icon={HandCoins} title="No one owes you right now" message='When a customer buys on credit (e.g. "Ama owes me 50"), you will see it here.' />;
  return (
    <div className="space-y-3">
      {open.map((debt) => {
        const paid = debt.originalAmount - debt.outstandingAmount;
        const progress = debt.originalAmount ? (paid / debt.originalAmount) * 100 : 0;
        return (
          <Card key={debt.id}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-bold">{debt.customerName}</h3>
                <p className="mt-1 text-sm text-muted-foreground">Last updated {safeDistance(debt.lastActivityAt)}</p>
              </div>
              <p className="text-lg font-black">{formatMoney(debt.outstandingAmount)}</p>
            </div>
            <Progress value={progress} className="mt-4" />
            <p className="mt-2 text-xs text-muted-foreground">{formatMoney(paid)} paid · started at {formatMoney(debt.originalAmount)}</p>
          </Card>
        );
      })}
    </div>
  );
}
