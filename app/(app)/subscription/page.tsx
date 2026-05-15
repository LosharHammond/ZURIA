"use client";

import { useState, useMemo } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  CrownIcon,
  FileText,
  Lock,
  Sparkles,
  TrendingUp,
  Zap,
  Flame,
} from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/stores/app-store";
import { SUBSCRIPTION_TIERS } from "@/types/domain";
import type { SubscriptionPlan } from "@/types/domain";
import { ReportDownloadButton } from "@/components/reports/report-download-button";
import { PaystackButton } from "@/components/payments/paystack-button";
import { computeHealthScoreBreakdown } from "@/lib/analytics/summary";
import { getEffectivePlan, isOnReferralUnlock, formatPlanExpiry, daysUntilExpiry } from "@/lib/subscription";
import { formatMoney } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────

const ADMIN_MOMO =
  process.env.NEXT_PUBLIC_ADMIN_MOMO ??
  process.env.NEXT_PUBLIC_ADMIN_PHONE?.replace(/^\+233/, "0").replace(/^233/, "0") ??
  "0242176603";

const SUPPORT_WA_HREF = `https://wa.me/${ADMIN_MOMO.replace(/^0/, "233").replace(/^\+/, "")}`;

const PLAN_META: Record<SubscriptionPlan, {
  color: string;
  bg: string;
  border: string;
  glow: string;
  emoji: string;
  annualPrice: number | null;
  payCmd: string;
}> = {
  free: {
    color: "text-muted-foreground",
    bg: "bg-white/[0.03]",
    border: "border-white/10",
    glow: "",
    emoji: "🆓",
    annualPrice: null,
    payCmd: "",
  },
  growth: {
    color: "text-emerald-400",
    bg: "bg-emerald-500/5",
    border: "border-emerald-500/30",
    glow: "shadow-emerald-500/10",
    emoji: "🟢",
    annualPrice: 180,   // GHS 180/yr — 2 months free on GHS 20/mo
    payCmd: "PAID GROWTH",
  },
  pro: {
    color: "text-cyan-400",
    bg: "bg-cyan-500/5",
    border: "border-cyan-500/30",
    glow: "shadow-cyan-500/10",
    emoji: "🔵",
    annualPrice: 500,   // GHS 500/yr — 2 months free on GHS 50/mo
    payCmd: "PAID PRO",
  },
  enterprise: {
    color: "text-amber-400",
    bg: "bg-amber-500/5",
    border: "border-amber-500/30",
    glow: "shadow-amber-500/10",
    emoji: "🟣",
    annualPrice: 1000,  // GHS 1000/yr — 2 months free on GHS 100/mo
    payCmd: "PAID ENTERPRISE",
  },
};

// ── Helpers — imported from shared lib/subscription.ts ───────────────────────
// getEffectivePlan, isOnReferralUnlock, formatPlanExpiry, daysUntilExpiry

// Local aliases to preserve call-site names in this file
const formatExpiry = formatPlanExpiry;
const daysRemaining = daysUntilExpiry;

// ── Plan Recommendation Engine ────────────────────────────────────────────────

interface PlanRecommendation {
  plan: SubscriptionPlan;
  reason: string;
  urgency: "high" | "medium" | "low";
  cta: string;
}

function computePlanRecommendation(params: {
  currentPlan: SubscriptionPlan;
  usagePct: number;
  transactionCount: number;
  hasDebts: boolean;
  hasLoans: boolean;
  score: number;
}): PlanRecommendation | null {
  const { currentPlan, usagePct, transactionCount, hasDebts, score } = params;

  if (currentPlan !== "free") {
    // Growth → upsell Pro
    if (currentPlan === "growth" && (transactionCount > 80 || score < 55)) {
      return {
        plan: "pro",
        reason: "Your volume & activity have outgrown Growth — Pro gives you unlimited entries and AI forecasting.",
        urgency: "medium",
        cta: "Move to Pro",
      };
    }
    return null;
  }

  // Free users
  if (usagePct >= 90) {
    return {
      plan: "growth",
      reason: "You've used 90%+ of your daily limit. Your business can't afford to stop recording.",
      urgency: "high",
      cta: "Unlock Unlimited Now",
    };
  }
  if (usagePct >= 70) {
    return {
      plan: "growth",
      reason: "You're running low on AI entries today. Growth gives you 200/month — never hit a wall.",
      urgency: "medium",
      cta: "Upgrade to Growth",
    };
  }
  if (hasDebts && transactionCount >= 5) {
    return {
      plan: "growth",
      reason: "You have customers who owe you. Growth sends auto-reminders so you never forget to collect.",
      urgency: "medium",
      cta: "Get Debt Reminders",
    };
  }
  if (transactionCount >= 20) {
    return {
      plan: "growth",
      reason: `You've recorded ${transactionCount}+ transactions — it's time to see your monthly report and real insights.`,
      urgency: "low",
      cta: "See Your Full Report",
    };
  }
  if (score < 55 && transactionCount >= 5) {
    return {
      plan: "growth",
      reason: "Your AI Business Score shows potential issues. Upgrade to see the full breakdown and fix them.",
      urgency: "medium",
      cta: "See Score Breakdown",
    };
  }
  return null;
}

// ── Current Plan Card ─────────────────────────────────────────────────────────

function CurrentPlanCard({ plan, expiresAt, messageCount, resetKey }: {
  plan: SubscriptionPlan;
  expiresAt?: string | null;
  messageCount: number;
  resetKey?: string | null;
}) {
  const tier = SUBSCRIPTION_TIERS[plan];
  const meta = PLAN_META[plan];

  const limitPeriodLabel = tier.limitPeriod === "daily" ? "today" : tier.limitPeriod === "monthly" ? "this month" : null;
  const usedOf = tier.messageLimit != null ? `${messageCount} / ${tier.messageLimit}` : null;
  const pctUsed = tier.messageLimit ? Math.min(100, Math.round((messageCount / tier.messageLimit) * 100)) : 0;
  const daysLeft = daysRemaining(expiresAt);

  // Urgency tiers for usage meter
  const meterColor =
    pctUsed >= 95 ? "bg-rose-500 animate-pulse" :
    pctUsed >= 80 ? "bg-rose-500" :
    pctUsed >= 60 ? "bg-amber-500" :
    "bg-primary";

  return (
    <GlassCard className={`relative overflow-hidden border ${meta.border}`}>
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className={`absolute -right-10 -top-10 h-48 w-48 rounded-full ${meta.bg} blur-2xl`} />
      </div>

      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Your current plan</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-lg">{meta.emoji}</span>
            <h2 className={`text-2xl font-black ${meta.color}`}>{tier.brand}</h2>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {plan !== "free" && daysLeft !== null && daysLeft > 0 && (
            <Badge variant="success" className="shrink-0">Active</Badge>
          )}
          {plan === "free" && <Badge variant="outline" className="shrink-0">Free</Badge>}
          {daysLeft !== null && daysLeft > 7 && (
            <span className="text-[10px] font-medium text-primary/70 bg-primary/10 px-2 py-0.5 rounded-full">
              {daysLeft}d left
            </span>
          )}
          {daysLeft !== null && daysLeft <= 7 && daysLeft > 0 && (
            <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
              ⏳ {daysLeft}d left
            </span>
          )}
          {daysLeft === 0 && (
            <span className="text-[10px] font-bold text-rose-400 bg-rose-400/10 px-2 py-0.5 rounded-full">Expired</span>
          )}
        </div>
      </div>

      {plan !== "free" && expiresAt && daysLeft !== null && daysLeft > 7 && (
        <p className="mt-2 text-sm text-muted-foreground">
          Valid until <span className="font-semibold text-foreground">{formatExpiry(expiresAt)}</span>
        </p>
      )}
      {plan !== "free" && expiresAt && daysLeft !== null && daysLeft <= 7 && daysLeft > 0 && (
        <p className="mt-2 text-sm text-amber-400 font-medium">
          ⚠️ Expires in {daysLeft} day{daysLeft !== 1 ? "s" : ""} — renew now to avoid interruption.
        </p>
      )}
      {plan !== "free" && daysLeft === 0 && (
        <p className="mt-2 text-sm text-rose-400 font-medium">
          Your plan has expired — you&apos;re on the free tier. Renew below to reactivate.
        </p>
      )}

      {usedOf && limitPeriodLabel && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
            <span>AI entries used {limitPeriodLabel}</span>
            <span className={`font-bold ${pctUsed >= 80 ? "text-rose-400" : pctUsed >= 60 ? "text-amber-400" : "text-foreground"}`}>
              {usedOf}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all duration-500 ${meterColor}`}
              style={{ width: `${pctUsed}%` }}
            />
          </div>
          {pctUsed >= 95 && (
            <p className="mt-1.5 text-xs text-rose-400 font-bold animate-pulse">
              🚨 CRITICAL — {tier.messageLimit! - messageCount} entries left. Your business goes dark when this hits zero.
            </p>
          )}
          {pctUsed >= 80 && pctUsed < 95 && (
            <p className="mt-1.5 text-xs text-rose-400 font-medium">
              ⛔ {100 - pctUsed}% left — upgrade before you hit the wall
            </p>
          )}
          {pctUsed >= 60 && pctUsed < 80 && (
            <p className="mt-1.5 text-xs text-amber-400">⚠️ Running low — consider upgrading soon</p>
          )}
          {resetKey && tier.limitPeriod === "daily" && (
            <p className="mt-1 text-xs text-muted-foreground">Resets at midnight · {resetKey}</p>
          )}
          {resetKey && tier.limitPeriod === "monthly" && (
            <p className="mt-1 text-xs text-muted-foreground">Resets monthly · period: {resetKey}</p>
          )}
        </div>
      )}

      {plan === "free" && (
        <p className="mt-3 text-sm text-muted-foreground leading-5">
          Free forever · {tier.messageLimit} AI entries/day · Resets at midnight.
          Every entry you miss is money you can&apos;t track. Upgrade to never be limited.
        </p>
      )}

      {plan !== "free" && !usedOf && (
        <p className="mt-3 text-sm text-muted-foreground leading-5">
          Unlimited AI entries — no daily or monthly cap. 🚀
        </p>
      )}
    </GlassCard>
  );
}

// ── Recommendation Banner ─────────────────────────────────────────────────────

function RecommendationBanner({ rec }: { rec: PlanRecommendation }) {
  const meta = PLAN_META[rec.plan];
  const urgencyStyle =
    rec.urgency === "high"
      ? "border-rose-500/30 bg-rose-500/[0.07]"
      : rec.urgency === "medium"
      ? "border-amber-500/25 bg-amber-500/[0.06]"
      : "border-primary/20 bg-primary/5";
  const iconStyle =
    rec.urgency === "high" ? "text-rose-400" : rec.urgency === "medium" ? "text-amber-400" : "text-primary";

  return (
    <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3.5 ${urgencyStyle}`}>
      <Flame className={`h-5 w-5 shrink-0 mt-0.5 ${rec.urgency === "high" ? "animate-pulse" : ""} ${iconStyle}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-bold ${iconStyle}`}>
          {rec.urgency === "high" ? "⚡ Action Needed — " : rec.urgency === "medium" ? "💡 Smart Move — " : "📈 Ready to Grow — "}
          {SUBSCRIPTION_TIERS[rec.plan].brand} recommended
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-5">{rec.reason}</p>
      </div>
      <a
        href="#plans"
        className={`shrink-0 flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors ${meta.border} border ${meta.color} ${meta.bg} hover:opacity-80`}
      >
        {rec.cta} <ChevronRight className="h-3 w-3" />
      </a>
    </div>
  );
}

// ── Blurred Feature Teasers ───────────────────────────────────────────────────

function BlurredFeatureTeasers({ upgradePlan }: { upgradePlan: "growth" | "pro" }) {
  const features = upgradePlan === "growth"
    ? [
        {
          title: "Monthly P&L Report",
          preview: "Revenue: GHS ???  |  Expenses: GHS ???  |  Net Profit: GHS ???",
          tag: "Growth+",
        },
        {
          title: "Auto Debt Reminders",
          preview: "3 customers owe you · Next reminder: Tomorrow 9am",
          tag: "Growth+",
        },
        {
          title: "Low-Stock Alerts",
          preview: "⚠️ Sachet water — 4 bags left · Reorder threshold: 10",
          tag: "Growth+",
        },
      ]
    : [
        {
          title: "AI Cash-Flow Forecast",
          preview: "Next 30 days: +GHS ??? projected · Risk: ???",
          tag: "Pro+",
        },
        {
          title: "Staff Accounts",
          preview: "Abena (cashier) · Kwame (manager) · Role-based access",
          tag: "Pro+",
        },
        {
          title: "Profit Margin by Product",
          preview: "Sachet water: ???% · Bread: ???% · Best: ???",
          tag: "Pro+",
        },
      ];

  const meta = PLAN_META[upgradePlan];

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
        🔒 Locked features — available on {SUBSCRIPTION_TIERS[upgradePlan].brand}
      </p>
      <div className="space-y-2.5">
        {features.map((f) => (
          <div key={f.title} className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
            {/* Blurred content */}
            <div className="pointer-events-none select-none blur-[3px] opacity-40 p-3.5">
              <p className="text-xs font-bold text-foreground mb-1">{f.title}</p>
              <p className="text-xs text-muted-foreground font-mono">{f.preview}</p>
            </div>
            {/* Overlay */}
            <div className="absolute inset-0 flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <Lock className={`h-3.5 w-3.5 ${meta.color}`} />
                <span className="text-xs font-bold text-foreground">{f.title}</span>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.color} ${meta.bg} ${meta.border}`}>
                {f.tag}
              </span>
            </div>
          </div>
        ))}
      </div>
      <a
        href="#plans"
        className={`mt-3 w-full flex items-center justify-center gap-2 rounded-2xl border py-3 text-sm font-bold transition-colors ${meta.border} ${meta.color} ${meta.bg} hover:opacity-80`}
      >
        Unlock {SUBSCRIPTION_TIERS[upgradePlan].brand} <ArrowRight className="h-4 w-4" />
      </a>
    </div>
  );
}

// ── AI Score Teaser (for free users) ─────────────────────────────────────────

function AIScoreTeaser({ score }: { score: number }) {
  const scoreColor = score >= 76 ? "text-emerald-400" : score >= 55 ? "text-amber-400" : "text-rose-400";

  return (
    <GlassCard className="border-primary/15 bg-primary/[0.03]">
      <div className="flex items-center gap-2 mb-3">
        <Brain className="h-4 w-4 text-primary" />
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">AI Business Score</p>
      </div>

      <div className="flex items-center gap-4">
        <div>
          <p className={`text-5xl font-black ${scoreColor}`}>{score}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">/100</p>
        </div>
        <div className="flex-1 space-y-2">
          {/* Blurred breakdown teaser */}
          {["Revenue Consistency", "Profit Margin", "Debt Burden"].map((dim) => (
            <div key={dim} className="blur-sm opacity-40 pointer-events-none select-none">
              <div className="flex justify-between mb-0.5">
                <span className="text-[10px] text-muted-foreground">{dim}</span>
                <span className="text-[10px] font-mono">??/??</span>
              </div>
              <div className="h-1 rounded-full bg-white/10">
                <div className="h-full w-3/5 rounded-full bg-primary/40" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-xl border border-primary/15 bg-primary/5 p-3">
        <Lock className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1">
          <p className="text-xs font-bold">What&apos;s holding your score back?</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Full AI breakdown + personalised recommendations — Growth plan unlocks it.
          </p>
        </div>
        <a href="#plans" className="shrink-0 flex items-center gap-1 rounded-full bg-primary/15 border border-primary/25 px-3 py-1.5 text-[11px] font-bold text-primary hover:bg-primary/25 transition-colors">
          See all <ChevronRight className="h-3 w-3" />
        </a>
      </div>
    </GlassCard>
  );
}

// ── Global Billing Toggle ─────────────────────────────────────────────────────

function BillingToggle({
  annual,
  onChange,
}: {
  annual: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-1">
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`flex-1 rounded-xl px-4 py-2 text-sm font-bold transition-all ${
          !annual ? "bg-white/[0.10] text-foreground shadow" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Monthly
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`flex-1 rounded-xl px-4 py-2 text-sm font-bold transition-all flex items-center justify-center gap-2 ${
          annual ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Annual
        <span className="text-[10px] font-black rounded-full bg-emerald-500/20 px-1.5 py-0.5">
          2 months FREE
        </span>
      </button>
    </div>
  );
}

// ── Tier Card ─────────────────────────────────────────────────────────────────

function TierCard({
  plan,
  isCurrentPlan,
  billingAnnual,
}: {
  plan: SubscriptionPlan;
  isCurrentPlan: boolean;
  billingAnnual: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [payError, setPayError] = useState("");
  const tier = SUBSCRIPTION_TIERS[plan];
  const meta = PLAN_META[plan];

  if (plan === "free") return null;

  const monthlyPrice = tier.priceGHS;
  const annualTotal  = meta.annualPrice ?? 0;
  const annualMonthlyCost = Math.round(annualTotal / 12);
  const annualSaving = monthlyPrice * 12 - annualTotal;

  return (
    <div
      id={plan === "growth" ? "plans" : undefined}
      className={`rounded-3xl border p-5 transition-all duration-300 ${meta.border} ${meta.bg} ${
        isCurrentPlan ? `shadow-xl ${meta.glow}` : ""
      } ${plan === "pro" && !isCurrentPlan ? "ring-1 ring-cyan-500/30" : ""}`}
    >
      {/* Popular badge */}
      {plan === "pro" && !isCurrentPlan && (
        <div className="mb-3 -mt-1">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 px-3 py-1 text-[11px] font-bold text-cyan-400">
            ⭐ Most Popular — Best value for growing businesses
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base">{meta.emoji}</span>
            <h3 className={`text-lg font-black ${meta.color}`}>{tier.brand}</h3>
            {isCurrentPlan && <Badge variant="success" className="text-[10px]">Current</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{tier.label}</p>
        </div>
        <div className="text-right shrink-0">
          {billingAnnual && meta.annualPrice ? (
            <>
              <p className={`text-2xl font-black ${meta.color}`}>
                GHS {annualTotal}
                <span className="text-xs font-normal text-muted-foreground">/yr</span>
              </p>
              <p className="text-[11px] text-emerald-400">≈ GHS {annualMonthlyCost}/mo · save GHS {annualSaving}</p>
            </>
          ) : (
            <>
              <p className={`text-2xl font-black ${meta.color}`}>
                GHS {monthlyPrice}
                <span className="text-xs font-normal text-muted-foreground">/mo</span>
              </p>
              {meta.annualPrice && (
                <p className="text-[11px] text-muted-foreground">or GHS {annualTotal}/yr</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Annual saving callout */}
      {billingAnnual && meta.annualPrice && !isCurrentPlan && (
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5">
          <BadgeCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          <p className="text-[11px] text-emerald-400 font-medium">
            You save GHS {annualSaving} vs paying monthly — like getting {plan === "growth" ? "2" : "2"} months free!
          </p>
        </div>
      )}

      {/* Limits */}
      <div className="mt-3 flex flex-wrap gap-2">
        {tier.messageLimit != null ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium">
            <Zap className={`h-3 w-3 ${meta.color}`} />
            {tier.messageLimit} entries/{tier.limitPeriod}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium">
            <Zap className={`h-3 w-3 ${meta.color}`} />
            Unlimited AI entries
          </span>
        )}
        {tier.reports.map((r) => (
          <span key={r} className="inline-flex items-center gap-1 rounded-lg bg-white/[0.05] px-2.5 py-1 text-[11px] text-muted-foreground capitalize">
            {r === "full_dashboard" ? "Full dashboard" : `${r} reports`}
          </span>
        ))}
      </div>

      {/* Feature list */}
      <ul className={`mt-3 space-y-2 overflow-hidden transition-all duration-300 ${expanded ? "" : "max-h-[120px]"}`}>
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <CheckCircle2 className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.color}`} />
            <span className="text-xs leading-5 text-muted-foreground">{f}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? (
          <><ChevronUp className="h-3.5 w-3.5" /> Show less</>
        ) : (
          <><ChevronDown className="h-3.5 w-3.5" /> Show all {tier.features.length} features</>
        )}
      </button>

      {/* Pay action */}
      {!isCurrentPlan && (
        <div className="mt-4 space-y-2">
          {payError && (
            <p className="rounded-xl bg-destructive/10 border border-destructive/25 px-3 py-2 text-xs text-destructive">
              {payError}
            </p>
          )}
          <PaystackButton
            plan={plan}
            annual={billingAnnual}
            label={
              billingAnnual && meta.annualPrice
                ? `Pay GHS ${annualTotal} — Subscribe Annually`
                : `Pay GHS ${monthlyPrice}/mo — Subscribe`
            }
            className="w-full"
            onError={setPayError}
          />
          <p className="text-center text-[11px] text-muted-foreground">
            MoMo · Bank Transfer · Card · Instant activation
          </p>
        </div>
      )}

      {/* Renew — shown for current plan */}
      {isCurrentPlan && (
        <div className="mt-4 space-y-2">
          {payError && (
            <p className="rounded-xl bg-destructive/10 border border-destructive/25 px-3 py-2 text-xs text-destructive">
              {payError}
            </p>
          )}
          <PaystackButton
            plan={plan}
            annual={billingAnnual}
            label="Renew / Extend Subscription"
            variant="outline"
            className="w-full"
            onError={setPayError}
          />
        </div>
      )}
    </div>
  );
}

// ── Comparison row ────────────────────────────────────────────────────────────

function CompRow({ f, v }: { f: string; v: string[] }) {
  return (
    <tr className="border-t border-white/[0.03]">
      <td className="py-2 pr-4 text-muted-foreground leading-4">{f}</td>
      {v.map((val, ci) => (
        <td
          key={ci}
          className={`py-2 text-center font-medium ${
            val === "✅" ? "text-emerald-400" :
            val === "—"  ? "text-white/15" :
            val === "∞"  ? "text-cyan-400" :
            "text-foreground"
          }`}
        >
          {val}
        </td>
      ))}
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SubscriptionPage() {
  const { user, transactions, debts, loans } = useAppStore();
  const [billingAnnual, setBillingAnnual] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const effectivePlan: SubscriptionPlan = user ? getEffectivePlan(user) : "free";
  const referralUnlock = user ? isOnReferralUnlock(user) : false;
  const messageCount = user?.whatsappMessageCount ?? 0;
  const expiresAt = referralUnlock ? user?.referralUnlockExpiresAt : user?.subscriptionExpiresAt;
  const resetKey = user?.whatsappMessageResetKey;

  const tier = SUBSCRIPTION_TIERS[effectivePlan];
  const usagePct = tier.messageLimit ? Math.min(100, Math.round((messageCount / tier.messageLimit) * 100)) : 0;

  const scoreBreakdown = useMemo(
    () => computeHealthScoreBreakdown(transactions, debts, loans),
    [transactions, debts, loans]
  );

  const recommendation = useMemo(() => computePlanRecommendation({
    currentPlan: effectivePlan,
    usagePct,
    transactionCount: transactions.length,
    hasDebts: debts.some((d) => d.outstandingAmount > 0),
    hasLoans: loans.some((l) => l.status === "open"),
    score: scoreBreakdown.score,
  }), [effectivePlan, usagePct, transactions.length, debts, loans, scoreBreakdown.score]);

  const plans: SubscriptionPlan[] = ["growth", "pro", "enterprise"];

  function copyText(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  // suppress lint warning — copied is used in JSX below
  void copied;

  // Compute annual savings for the banner (based on all paid plans)
  const maxAnnualSaving = Math.max(
    ...plans.map((p) => {
      const t = SUBSCRIPTION_TIERS[p];
      const m = PLAN_META[p];
      return m.annualPrice ? t.priceGHS * 12 - m.annualPrice : 0;
    })
  );

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <p className="text-sm text-primary">Account</p>
        <h1 className="mt-1 text-3xl font-black">Your Business Plan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ZURIA is the AI memory system for your business — the more data you record, the smarter it gets.
        </p>
      </div>

      {/* Current plan */}
      <CurrentPlanCard
        plan={effectivePlan}
        expiresAt={expiresAt}
        messageCount={messageCount}
        resetKey={resetKey}
      />

      {/* Referral unlock badge */}
      {referralUnlock && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.08] px-4 py-3">
          <span className="text-xl shrink-0 mt-0.5">🎁</span>
          <div>
            <p className="text-sm font-bold text-emerald-300">Growth unlocked — Referral Milestone! 🏆</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-5">
              You referred 30+ people this month — Growth features are yours FREE until{" "}
              <span className="font-semibold text-emerald-400">{formatExpiry(user?.referralUnlockExpiresAt)}</span>.
              Keep referring next month to extend it again!
            </p>
          </div>
        </div>
      )}

      {/* AI-powered plan recommendation */}
      {recommendation && <RecommendationBanner rec={recommendation} />}

      {/* AI Business Score — teaser for free, full for paid */}
      {effectivePlan === "free" && (
        <AIScoreTeaser score={scoreBreakdown.score} />
      )}

      {/* Free-user conversion block */}
      {effectivePlan === "free" && (
        <>
          <GlassCard className="border-primary/15 bg-primary/5">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-bold">From recording… to understanding.</h3>
                <p className="mt-1 text-sm text-muted-foreground leading-6">
                  Free gives you the foundation. Paid plans unlock AI forecasting, auto reminders,
                  monthly reports, staff accounts — the intelligence that makes ZURIA your business brain, not just a ledger.
                </p>
              </div>
            </div>
          </GlassCard>

          {/* Blurred premium teasers */}
          <GlassCard className="border-white/[0.06]">
            <BlurredFeatureTeasers upgradePlan="growth" />
          </GlassCard>

          {/* Refer & Earn path */}
          <GlassCard className="border-amber-500/20 bg-amber-500/[0.04]">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-400 mb-3">🎁 Get Growth for FREE</p>
            <div className="space-y-2">
              <div className="flex gap-3 items-start rounded-xl bg-emerald-500/5 border border-emerald-500/15 p-3">
                <span className="text-base font-black text-emerald-400 shrink-0 w-5">1</span>
                <div>
                  <p className="text-sm font-bold text-emerald-300">Earn GHS 5 → Withdraw cash 💵</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Refer 10 friends to ZURIA. Once your balance hits GHS 5, request a MoMo payout in the Refer &amp; Earn tab.</p>
                </div>
              </div>
              <div className="flex gap-3 items-start rounded-xl bg-amber-500/5 border border-amber-500/15 p-3">
                <span className="text-base font-black text-amber-400 shrink-0 w-5">2</span>
                <div>
                  <p className="text-sm font-bold text-amber-300">30 referrals this month → Growth FREE 🚀</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Refer 30 people in one calendar month and unlock ZURIA Growth — monthly reports, AI insights, debt reminders, inventory alerts — completely free until month end. Worth GHS {SUBSCRIPTION_TIERS.growth.priceGHS}!</p>
                </div>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <a href="/referrals" className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500/15 border border-amber-500/25 py-2.5 text-sm font-semibold text-amber-300 hover:bg-amber-500/25 transition-colors">
                <ArrowRight className="h-4 w-4" />
                Go to Refer &amp; Earn
              </a>
            </div>
          </GlassCard>
        </>
      )}

      {/* Growth user — upsell to Pro */}
      {effectivePlan === "growth" && (
        <>
          <GlassCard className="border-cyan-500/15 bg-cyan-500/5">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/10">
                <TrendingUp className="h-5 w-5 text-cyan-400" />
              </div>
              <div>
                <h3 className="font-bold">Ready to go further?</h3>
                <p className="mt-1 text-sm text-muted-foreground leading-6">
                  Pro unlocks AI cash-flow forecasting, staff accounts, unlimited entries,
                  advanced analytics, and the full ZURIA intelligence engine.
                </p>
              </div>
            </div>
          </GlassCard>
          <GlassCard className="border-white/[0.06]">
            <BlurredFeatureTeasers upgradePlan="pro" />
          </GlassCard>
        </>
      )}

      {effectivePlan === "pro" && (
        <GlassCard className="border-amber-500/15 bg-amber-500/5">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10">
              <CrownIcon className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h3 className="font-bold">Take it to Enterprise 👑</h3>
              <p className="mt-1 text-sm text-muted-foreground leading-6">
                Multi-branch management, a dedicated account manager, predictive sales AI,
                competitive intelligence alerts, and API integrations for your whole operation.
              </p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Annual deal banner */}
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
        <BadgeCheck className="h-5 w-5 shrink-0 text-emerald-400" />
        <p className="text-sm text-emerald-300 font-medium">
          Pay annually and get <strong>2 months free</strong> — save up to{" "}
          {formatMoney(maxAnnualSaving)} per year.
        </p>
      </div>

      {/* ── Global billing toggle ── */}
      <BillingToggle annual={billingAnnual} onChange={setBillingAnnual} />

      {/* Plan cards */}
      <div id="plans" className="space-y-4">
        {plans.map((p) => (
          <TierCard
            key={p}
            plan={p}
            isCurrentPlan={effectivePlan === p}
            billingAnnual={billingAnnual}
          />
        ))}
      </div>

      {/* Payment info */}
      <GlassCard>
        <h3 className="flex items-center gap-2 font-bold">
          <span className="text-xl">💳</span> How payment works
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Pay securely via Paystack — Ghana&apos;s leading payment platform. Supports MoMo, bank transfer, and card. Your subscription activates instantly after payment.
        </p>

        <div className="mt-4 space-y-2">
          {[
            { icon: "📱", label: "MTN MoMo, Telecel Cash, AirtelTigo Money, Vodafone Cash" },
            { icon: "🏦", label: "Bank transfer — any Ghanaian bank account" },
            { icon: "💳", label: "Visa / Mastercard debit or credit card" },
          ].map(({ icon, label }) => (
            <div key={label} className="flex items-center gap-3 rounded-2xl bg-white/[0.03] px-4 py-3">
              <span className="text-base">{icon}</span>
              <p className="text-sm text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">How it works</p>
          {[
            "Choose your plan above and click Pay — a secure Paystack checkout page opens",
            "Select your payment method (MoMo, bank, or card) and complete payment",
            "You are redirected back and your subscription activates automatically",
            "We also send a WhatsApp / Telegram confirmation once activated",
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3 mb-2 last:mb-0">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-black text-primary">
                {i + 1}
              </span>
              <p className="text-xs text-muted-foreground leading-5">{step}</p>
            </div>
          ))}
        </div>

        <details className="mt-4 group">
          <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors list-none">
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            Prefer to pay manually via MoMo USSD?
          </summary>
          <div className="mt-3 space-y-2">
            {[
              { network: "MTN MoMo",        code: "*170#", instruction: "Send Money"   },
              { network: "Telecel Cash",     code: "*100#", instruction: "Send Money"   },
              { network: "AirtelTigo Money", code: "*185#", instruction: "Make Payment" },
              { network: "Vodafone Cash",    code: "*110#", instruction: "Send Money"   },
            ].map((n) => (
              <div key={n.network} className="flex items-center justify-between rounded-2xl bg-white/[0.04] px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">{n.network}</p>
                  <p className="text-xs text-muted-foreground">
                    Dial {n.code} → {n.instruction} → {ADMIN_MOMO}
                  </p>
                </div>
                <button
                  onClick={() => copyText(ADMIN_MOMO)}
                  className="flex items-center gap-1.5 rounded-xl bg-white/[0.06] px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {ADMIN_MOMO}
                </button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground leading-5 px-1">
              After manual payment, message ZURIA on <strong className="text-[#5AC8FA]">Telegram</strong> or the <strong className="text-amber-300">WhatsApp Sandbox</strong> with{" "}
              <code className="font-mono">PAID GROWTH</code>, <code className="font-mono">PAID PRO</code>, or <code className="font-mono">PAID ENTERPRISE</code>.
              We will verify and activate within 1 hour.
            </p>
          </div>
        </details>
      </GlassCard>

      {/* Feature comparison */}
      <GlassCard>
        <h3 className="font-bold mb-1">Full capability comparison</h3>
        <p className="text-xs text-muted-foreground mb-4">Every feature across all 4 plans at a glance.</p>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs min-w-[420px]">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="py-2 pr-4 text-left font-medium text-muted-foreground w-[45%]">Feature</th>
                <th className="py-2 text-center font-medium text-muted-foreground">Free</th>
                <th className="py-2 text-center font-medium text-emerald-400">Growth</th>
                <th className="py-2 text-center font-medium text-cyan-400">Pro</th>
                <th className="py-2 text-center font-medium text-amber-400">Ent.</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={5} className="pt-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-primary/70">Limits &amp; Recording</td></tr>
              {[
                ["Daily AI entries", "10/day", "200/mo", "∞", "∞"],
                ["Voice / text recording via WhatsApp", "✅", "✅", "✅", "✅"],
                ["Sales & expense tracking", "✅", "✅", "✅", "✅"],
                ["Multi-currency support", "✅", "✅", "✅", "✅"],
                ["Offline-first (sync when online)", "✅", "✅", "✅", "✅"],
              ].map(([f, ...v]) => <CompRow key={f} f={f} v={v} />)}

              <tr><td colSpan={5} className="pt-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-primary/70">AI Intelligence</td></tr>
              {[
                ["AI Business Score (basic)", "✅", "✅", "✅", "✅"],
                ["AI Score full breakdown", "—", "✅", "✅", "✅"],
                ["Contextual AI tips & insights", "—", "✅", "✅", "✅"],
                ["AI business coach (on-demand)", "—", "—", "✅", "✅"],
                ["AI cash-flow forecasting", "—", "—", "✅", "✅"],
                ["Predictive sales & demand AI", "—", "—", "—", "✅"],
                ["Competitive intelligence alerts", "—", "—", "—", "✅"],
              ].map(([f, ...v]) => <CompRow key={f} f={f} v={v} />)}

              <tr><td colSpan={5} className="pt-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-primary/70">Reports</td></tr>
              {[
                ["Daily end-of-day summary (WhatsApp)", "✅", "✅", "✅", "✅"],
                ["Weekly SMS-style report", "✅", "✅", "✅", "✅"],
                ["Monthly P&L report", "—", "✅", "✅", "✅"],
                ["PDF / printable report download", "—", "✅", "✅", "✅"],
                ["Full business dashboard", "—", "—", "✅", "✅"],
                ["Executive KPI dashboard", "—", "—", "—", "✅"],
              ].map(([f, ...v]) => <CompRow key={f} f={f} v={v} />)}

              <tr><td colSpan={5} className="pt-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-primary/70">Finance &amp; Debt</td></tr>
              {[
                ["Debt & customer credit tracking", "✅", "✅", "✅", "✅"],
                ["Expense category breakdown", "—", "✅", "✅", "✅"],
                ["Automated debt reminder messages", "—", "✅", "✅", "✅"],
                ["Cash-flow health score", "—", "✅", "✅", "✅"],
                ["Profit margin analysis by product", "—", "—", "✅", "✅"],
              ].map(([f, ...v]) => <CompRow key={f} f={f} v={v} />)}

              <tr><td colSpan={5} className="pt-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-primary/70">Inventory</td></tr>
              {[
                ["Basic stock tracking", "✅", "✅", "✅", "✅"],
                ["Low-stock WhatsApp alerts", "—", "✅", "✅", "✅"],
                ["Supplier management", "—", "—", "✅", "✅"],
                ["Auto reorder suggestions", "—", "—", "✅", "✅"],
                ["Multi-branch stock sync", "—", "—", "—", "✅"],
              ].map(([f, ...v]) => <CompRow key={f} f={f} v={v} />)}

              <tr><td colSpan={5} className="pt-4 pb-1 text-[10px] font-bold uppercase tracking-widests text-primary/70">Operations &amp; Team</td></tr>
              {[
                ["Staff / employee accounts", "—", "—", "✅", "✅"],
                ["Role-based access control", "—", "—", "✅", "✅"],
                ["Customer loyalty tracking", "—", "—", "✅", "✅"],
                ["WhatsApp commerce layer", "—", "—", "✅", "✅"],
                ["Multi-branch management", "—", "—", "—", "✅"],
                ["API access for integrations", "—", "—", "—", "✅"],
              ].map(([f, ...v]) => <CompRow key={f} f={f} v={v} />)}

              <tr><td colSpan={5} className="pt-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-primary/70">Support</td></tr>
              {[
                ["Community support", "✅", "✅", "✅", "✅"],
                ["WhatsApp support (business hours)", "—", "✅", "✅", "✅"],
                ["Priority support", "—", "—", "✅", "✅"],
                ["Dedicated account manager", "—", "—", "—", "✅"],
                ["Custom onboarding & training", "—", "—", "—", "✅"],
              ].map(([f, ...v]) => <CompRow key={f} f={f} v={v} />)}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* PDF Report Downloads — Growth+ only */}
      {(effectivePlan === "growth" || effectivePlan === "pro" || effectivePlan === "enterprise") && (
        <GlassCard className="border-primary/15">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="h-4 w-4 text-primary" />
            <h3 className="font-bold">Download Reports</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-4 leading-5">
            Generate a beautiful branded PDF report — opens in a new tab with your browser&apos;s print dialog for one-click saving.
          </p>
          <div className="flex flex-wrap gap-3">
            <ReportDownloadButton type="daily" size="sm" />
            <ReportDownloadButton type="weekly" size="sm" />
            <ReportDownloadButton type="monthly" size="sm" />
          </div>
        </GlassCard>
      )}

      {/* Support CTA */}
      <GlassCard className="text-center">
        <p className="text-sm text-muted-foreground">
          Have questions? We&apos;re here to help.
        </p>
        <Button asChild variant="outline" className="mt-3 gap-2">
          <a href={SUPPORT_WA_HREF} target="_blank" rel="noopener noreferrer">
            Chat with us on WhatsApp <ArrowRight className="h-4 w-4" />
          </a>
        </Button>
      </GlassCard>
    </div>
  );
}
