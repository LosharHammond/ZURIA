"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  HandCoins,
  MessageCircle,
  PiggyBank,
  ShoppingBag,
  TrendingUp,
  UserPlus,
  Wallet,
} from "lucide-react";
import { DailySummaryCard } from "@/components/dashboard/daily-summary-card";
import { HealthScore } from "@/components/dashboard/health-score";
import { MetricCard } from "@/components/dashboard/metric-card";
import { FinanceBreakdown } from "@/components/dashboard/finance-breakdown";
import { TransactionComposer } from "@/components/transactions/transaction-composer";
import { RecentActivity } from "@/components/transactions/recent-activity";
import { Skeleton } from "@/components/ui/skeleton";

// ── Lazy-load recharts (SalesChart) ─────────────────────────────────────────
// recharts is ~180 kB (50 kB gzipped). Deferring it keeps the dashboard
// interactive on first paint while the chart loads in the background.
const SalesChart = dynamic(
  () => import("@/components/dashboard/sales-chart").then((m) => ({ default: m.SalesChart })),
  {
    ssr: false,
    loading: () => <Skeleton className="h-64" />,
  }
);
import { useBusinessData } from "@/hooks/use-business-data";
import { useAppStore } from "@/stores/app-store";
import { formatMoney } from "@/lib/utils";
import Link from "next/link";
import { DashboardSkeleton } from "@/components/ui/skeleton";
import type { BusinessCategory } from "@/types/domain";

function getSoldPrefix(cat?: BusinessCategory) {
  if (cat === "barber" || cat === "salon") return "Cut hair ";
  if (cat === "food" || cat === "restaurant") return "Sold food ";
  if (cat === "momo") return "Received ";
  return "Sold ";
}

export default function DashboardPage() {
  const data = useBusinessData();
  const category = useAppStore((s) => s.business?.category);
  const effectivePlan = useAppStore((s) => s.user?.subscriptionPlan ?? "free");
  const waNumber = process.env.NEXT_PUBLIC_WA_NUMBER;
  const [composerPrefill, setComposerPrefill] = useState("");

  if (data.loading) return <DashboardSkeleton />;

  const netVariant = data.netPosition >= 0 ? "positive" : "negative";
  const hasBorrowingActivity = data.borrowingsIn > 0 || data.borrowingsOut > 0 || data.loansTaken > 0 || data.loansGiven > 0;

  return (
    <div className="space-y-6">
      {/* ── Welcome header ── */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-primary">Welcome back, {data.user?.ownerName ?? "friend"}</p>
          <h1 className="mt-1 text-3xl font-black md:text-5xl">{data.business?.name ?? "Your business"}</h1>
        </div>
        {waNumber && (
          <Link
            href={`https://wa.me/${waNumber}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1.5 rounded-2xl bg-[#25D366]/15 px-4 py-3 text-[#25D366] transition-all active:scale-95 hover:bg-[#25D366]/25 shrink-0"
          >
            <MessageCircle className="h-5 w-5" />
            <span className="text-[10px] font-semibold">WhatsApp</span>
          </Link>
        )}
      </div>

      {/* ── Quick action chips ── */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setComposerPrefill(getSoldPrefix(category))}
          className="flex items-center gap-2 rounded-full bg-emerald-400/15 px-4 py-2 text-sm font-semibold text-emerald-400 transition-all hover:bg-emerald-400/25 active:scale-95"
        >
          <ShoppingBag className="h-4 w-4" /> Record a sale
        </button>
        <button
          type="button"
          onClick={() => setComposerPrefill("Paid ")}
          className="flex items-center gap-2 rounded-full bg-rose-400/15 px-4 py-2 text-sm font-semibold text-rose-400 transition-all hover:bg-rose-400/25 active:scale-95"
        >
          <Wallet className="h-4 w-4" /> Record expense
        </button>
        <button
          type="button"
          onClick={() => setComposerPrefill("Ama owes me ")}
          className="flex items-center gap-2 rounded-full bg-amber-400/15 px-4 py-2 text-sm font-semibold text-amber-400 transition-all hover:bg-amber-400/25 active:scale-95"
        >
          <UserPlus className="h-4 w-4" /> Customer owes me
        </button>
      </div>

      {/* ── Primary metrics (row 1) ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Money Received Today"
          value={formatMoney(data.moneyIn)}
          detail="All money that came in"
          icon={ArrowUpRight}
          variant="positive"
          delay={0}
        />
        <MetricCard
          title="Money Spent Today"
          value={formatMoney(data.moneyOut)}
          detail="All money that went out"
          icon={ArrowDownLeft}
          variant="negative"
          delay={0.05}
        />
        <MetricCard
          title="What You Made"
          value={formatMoney(data.netPosition)}
          detail="After earning and spending"
          icon={TrendingUp}
          variant={netVariant}
          delay={0.1}
        />
        <MetricCard
          title="Customers Still Owe You"
          value={formatMoney(data.debtOwed)}
          detail="People who bought on credit"
          icon={HandCoins}
          variant="warning"
          delay={0.15}
        />
      </div>

      {/* ── Secondary metrics (row 2) — show only when relevant ── */}
      {(data.salesToday > 0 || data.salaryCosts > 0 || hasBorrowingActivity) && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Sales Today"
            value={formatMoney(data.salesToday)}
            detail="From selling your goods"
            icon={Banknote}
            variant="positive"
            delay={0.2}
          />
          <MetricCard
            title="Money Spent Running Shop"
            value={formatMoney(data.expensesToday + data.stockCosts + data.salaryCosts + data.taxCosts + data.fixedCosts)}
            detail="Bills, goods & workers"
            icon={Wallet}
            variant="negative"
            delay={0.25}
          />
          {data.loansTaken > 0 && (
            <MetricCard
              title="You Still Owe"
              value={formatMoney(data.loansTaken)}
              detail="Loan you need to pay back"
              icon={PiggyBank}
              variant="warning"
              delay={0.3}
            />
          )}
          {data.loansGiven > 0 && (
            <MetricCard
              title="Others Owe You (Loan)"
              value={formatMoney(data.loansGiven)}
              detail="Money you lent out"
              icon={HandCoins}
              variant="neutral"
              delay={0.35}
            />
          )}
        </div>
      )}

      {/* ── Main content grid ── */}
      <div className="grid gap-6 lg:grid-cols-[1.05fr_.95fr]">
        <div className="space-y-6">
          <TransactionComposer
            initialText={composerPrefill}
            onInitialUsed={() => setComposerPrefill("")}
          />
          <SalesChart data={data.chartData} />
        </div>
        <div className="space-y-6">
          <HealthScore
            value={data.healthScore}
            breakdown={data.healthScoreBreakdown}
            plan={effectivePlan}
          />
          <DailySummaryCard summary={data.summary} ownerName={data.user?.ownerName} />
        </div>
      </div>

      {/* ── Finance breakdown ── */}
      <FinanceBreakdown
        stockCosts={data.stockCosts}
        salaryCosts={data.salaryCosts}
        taxCosts={data.taxCosts}
        fixedCosts={data.fixedCosts}
        borrowingsIn={data.borrowingsIn}
        borrowingsOut={data.borrowingsOut}
        loanRepaymentsOut={data.loanRepaymentsOut}
        loanCollectionsIn={data.loanCollectionsIn}
        investmentsIn={data.investmentsIn}
        withdrawalsOut={data.withdrawalsOut}
        refundsIn={data.refundsIn}
        refundsOut={data.refundsOut}
        loansGiven={data.loansGiven}
        loansTaken={data.loansTaken}
      />

      {/* ── Recent activity ── */}
      <section>
        <h2 className="mb-3 text-xl font-black">What happened recently</h2>
        <RecentActivity transactions={data.transactions} />
      </section>
    </div>
  );
}
