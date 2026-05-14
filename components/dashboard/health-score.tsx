"use client";

import { Brain, ChevronRight, HeartPulse, Lock, TrendingDown, TrendingUp } from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { HealthScoreBreakdown } from "@/lib/analytics/summary";
import type { SubscriptionPlan } from "@/types/domain";
import Link from "next/link";

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 76) return "text-emerald-400";
  if (score >= 55) return "text-amber-400";
  return "text-rose-400";
}

function scoreRingColor(score: number): string {
  if (score >= 76) return "stroke-emerald-400";
  if (score >= 55) return "stroke-amber-400";
  return "stroke-rose-400";
}

function scoreLabel(score: number): { emoji: string; headline: string; sub: string } {
  if (score >= 85) return { emoji: "🌟", headline: "Excellent", sub: "Your business is thriving — keep it going!" };
  if (score >= 70) return { emoji: "✅", headline: "Strong", sub: "Solid performance. A few tweaks could make it exceptional." };
  if (score >= 55) return { emoji: "⚡", headline: "Growing", sub: "Good momentum. Watch your costs and debts closely." };
  if (score >= 40) return { emoji: "⚠️", headline: "Needs work", sub: "Revenue or consistency could be stronger this week." };
  return { emoji: "🔴", headline: "At risk", sub: "Expenses, debt, or inactivity are hurting your score." };
}

function barColor(value: number, max: number, isGood: boolean): string {
  const pct = value / max;
  if (isGood) return pct >= 0.7 ? "bg-emerald-400" : pct >= 0.4 ? "bg-amber-400" : "bg-rose-400";
  // Penalty bars: higher is worse
  return pct <= 0.3 ? "bg-emerald-400" : pct <= 0.6 ? "bg-amber-400" : "bg-rose-400";
}

// ── Score Ring (SVG) ──────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
      <svg className="-rotate-90" width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={r} strokeWidth="8" className="stroke-white/10 fill-none" />
        <circle
          cx="48" cy="48" r={r}
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          className={`${scoreRingColor(score)} transition-all duration-700`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-black leading-none ${scoreColor(score)}`}>{score}</span>
        <span className="text-[9px] font-medium text-muted-foreground">/100</span>
      </div>
    </div>
  );
}

// ── Dimension Row ─────────────────────────────────────────────────────────────

function DimensionRow({
  label,
  hint,
  value,
  max,
  isGood,
}: {
  label: string;
  hint: string;
  value: number;
  max: number;
  isGood: boolean;
}) {
  const pct = Math.round((value / max) * 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          {isGood
            ? <TrendingUp className="h-3 w-3 text-muted-foreground" />
            : <TrendingDown className="h-3 w-3 text-muted-foreground" />}
          <span className="text-xs font-medium">{label}</span>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          {value}/{max}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor(value, max, isGood)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>
    </div>
  );
}

// ── AI Narrative ──────────────────────────────────────────────────────────────

function aiNarrative(bd: HealthScoreBreakdown): string {
  const parts: string[] = [];

  if (bd.salesDays >= 6) {
    parts.push("You sold every day this week — excellent consistency.");
  } else if (bd.salesDays >= 4) {
    parts.push(`You recorded sales on ${bd.salesDays} of 7 days — decent rhythm.`);
  } else {
    parts.push(`Sales on only ${bd.salesDays} day${bd.salesDays !== 1 ? "s" : ""} — try to record every trading day.`);
  }

  if (bd.weeklyRevenue > 0) {
    const marginPct = Math.round(((bd.weeklyRevenue - bd.weeklyExpenses) / bd.weeklyRevenue) * 100);
    if (marginPct >= 40) {
      parts.push(`Strong ${marginPct}% profit margin this week.`);
    } else if (marginPct >= 15) {
      parts.push(`${marginPct}% margin — acceptable, but room to reduce costs.`);
    } else {
      parts.push(`Low ${marginPct}% margin — your expenses are eating into profit.`);
    }
  }

  if (bd.totalDebt > 0) {
    parts.push(`GHS ${bd.totalDebt.toFixed(0)} in customer debt outstanding — chase repayments.`);
  }

  if (bd.totalLoansTaken > 0) {
    parts.push(`GHS ${bd.totalLoansTaken.toFixed(0)} in loans taken — plan your repayment schedule.`);
  }

  return parts.join(" ");
}

// ── Main Component ────────────────────────────────────────────────────────────

interface HealthScoreProps {
  /** Simple score for backward compatibility (used when breakdown is not available) */
  value?: number;
  /** Full breakdown for the AI Score Engine view */
  breakdown?: HealthScoreBreakdown;
  /** User's effective subscription plan — gates the breakdown view */
  plan?: SubscriptionPlan;
}

export function HealthScore({ value, breakdown, plan }: HealthScoreProps) {
  // Derive score from breakdown if available, else from prop
  const score = breakdown?.score ?? Math.min(100, Math.max(0, Math.round(value ?? 0)));
  const clamped = Math.min(100, Math.max(0, Math.round(score)));
  const isPaid = plan === "growth" || plan === "pro" || plan === "enterprise";
  const label = scoreLabel(clamped);

  // ── Paid view: full AI Business Score Engine ──────────────────────────────
  if (isPaid && breakdown) {
    const narrative = aiNarrative(breakdown);
    return (
      <GlassCard className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-primary/5 blur-2xl" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                AI Business Score
              </p>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xl">{label.emoji}</span>
              <span className={`text-2xl font-black ${scoreColor(clamped)}`}>{label.headline}</span>
            </div>
          </div>
          <ScoreRing score={clamped} />
        </div>

        {/* AI Narrative */}
        <p className="mt-3 text-xs leading-5 text-muted-foreground italic">
          &ldquo;{narrative}&rdquo;
        </p>

        {/* Score Dimensions */}
        <div className="mt-4 space-y-3.5">
          <DimensionRow
            label="Revenue Consistency"
            hint={`Sold on ${breakdown.salesDays}/7 days this week`}
            value={breakdown.consistency}
            max={breakdown.consistencyMax}
            isGood={true}
          />
          <DimensionRow
            label="Profit Margin"
            hint={breakdown.weeklyRevenue > 0
              ? `${Math.max(0, Math.round(((breakdown.weeklyRevenue - breakdown.weeklyExpenses) / breakdown.weeklyRevenue) * 100))}% margin this week`
              : "No sales data this week"}
            value={breakdown.margin}
            max={breakdown.marginMax}
            isGood={true}
          />
          <DimensionRow
            label="Debt Burden"
            hint={breakdown.totalDebt > 0
              ? `GHS ${breakdown.totalDebt.toFixed(0)} in outstanding customer debt`
              : "No unpaid customer debts ✅"}
            value={breakdown.debtPenalty}
            max={breakdown.debtPenaltyMax}
            isGood={false}
          />
          <DimensionRow
            label="Loan Exposure"
            hint={breakdown.totalLoansTaken > 0
              ? `GHS ${breakdown.totalLoansTaken.toFixed(0)} borrowed — track repayments`
              : "No active loans taken ✅"}
            value={breakdown.loanPenalty}
            max={breakdown.loanPenaltyMax}
            isGood={false}
          />
        </div>

        <p className="mt-4 text-[10px] text-muted-foreground">
          Score reflects last 7 days · updates with every transaction
        </p>
      </GlassCard>
    );
  }

  // ── Free view: score only + blurred teaser ────────────────────────────────
  return (
    <GlassCard className="relative overflow-hidden">
      {/* Simple score header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">How your business is doing</p>
          <p className={`mt-1 text-3xl font-black ${scoreColor(clamped)}`}>{clamped}/100</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{label.headline} {label.emoji}</p>
        </div>
        <HeartPulse className="h-8 w-8 text-accent" />
      </div>
      <Progress value={clamped} className="mt-4" />

      {/* Blurred breakdown teaser */}
      <div className="relative mt-4 overflow-hidden rounded-2xl border border-white/[0.06]">
        {/* Blurred content */}
        <div className="pointer-events-none select-none blur-sm opacity-50 p-3 space-y-2.5">
          {["Revenue Consistency", "Profit Margin", "Debt Burden", "Loan Exposure"].map((dim) => (
            <div key={dim}>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-muted-foreground">{dim}</span>
                <span className="text-[10px] text-muted-foreground font-mono">??/??</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10">
                <div className="h-full w-1/2 rounded-full bg-primary/40" />
              </div>
            </div>
          ))}
        </div>
        {/* Overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/60 backdrop-blur-[2px]">
          <Lock className="h-5 w-5 text-primary mb-1.5" />
          <p className="text-xs font-bold text-foreground">See what&apos;s holding you back</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 text-center px-6">
            Full score breakdown + AI insights — Growth plan and above
          </p>
          <Link
            href="/subscription"
            className="mt-2.5 flex items-center gap-1 rounded-full bg-primary/15 border border-primary/25 px-3 py-1.5 text-[11px] font-bold text-primary hover:bg-primary/25 transition-colors"
          >
            Upgrade to unlock <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </GlassCard>
  );
}
