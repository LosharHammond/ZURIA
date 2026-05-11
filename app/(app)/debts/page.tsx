"use client";

import { DebtList } from "@/components/debts/debt-list";
import { LoanList } from "@/components/debts/loan-list";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useBusinessData } from "@/hooks/use-business-data";
import { formatMoney } from "@/lib/utils";

export default function DebtsPage() {
  const { debts, loans, debtOwed, loansGiven, loansTaken, loading } = useBusinessData();

  if (loading) return <PageSkeleton rows={5} />;

  const openDebts = debts.filter((d) => d.status === "open");
  const openLoans = loans.filter((l) => l.status === "open");

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-secondary">Keep track of who owes you</p>
        <h1 className="mt-1 text-3xl font-black">Money Owed &amp; Loans</h1>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <SummaryTile label="They Owe You" value={formatMoney(debtOwed)} color="text-yellow-400" />
        <SummaryTile label="You Gave Out" value={formatMoney(loansGiven)} color="text-sky-400" />
        <SummaryTile label="You Still Owe" value={formatMoney(loansTaken)} color="text-amber-400" />
      </div>

      <section>
        <h2 className="mb-4 text-xl font-black">What Customers Owe You</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {openDebts.length} open &middot; {formatMoney(debtOwed)} outstanding
        </p>
        <DebtList debts={debts} />
      </section>

      <section>
        <h2 className="mb-4 text-xl font-black">Money You Borrowed or Lent</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {openLoans.length} open &middot; Cash loans you gave or got
        </p>
        <LoanList loans={loans} />
      </section>
    </div>
  );
}

function SummaryTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.06] p-4 text-center">
      <p className={`text-lg font-black ${color}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground leading-tight">{label}</p>
    </div>
  );
}
