"use client";

import { TransactionComposer } from "@/components/transactions/transaction-composer";
import { RecentActivity } from "@/components/transactions/recent-activity";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useBusinessData } from "@/hooks/use-business-data";

export default function TransactionsPage() {
  const { transactions, loading } = useBusinessData();

  if (loading) return <PageSkeleton rows={5} />;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-primary">Record as you go</p>
        <h1 className="mt-1 text-3xl font-black">What happened today?</h1>
      </div>
      <TransactionComposer />
      <RecentActivity transactions={transactions} />
    </div>
  );
}
