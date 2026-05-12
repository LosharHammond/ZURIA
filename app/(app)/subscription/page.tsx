"use client";

import { useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  CrownIcon,
  FileText,
  Sparkles,
  Zap,
} from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/stores/app-store";
import { SUBSCRIPTION_TIERS } from "@/types/domain";
import type { SubscriptionPlan } from "@/types/domain";
import { ReportDownloadButton } from "@/components/reports/report-download-button";

// ── Constants ─────────────────────────────────────────────────────────────────

// Set NEXT_PUBLIC_ADMIN_MOMO (or NEXT_PUBLIC_ADMIN_PHONE as fallback) in your hosting config.
const ADMIN_MOMO =
  process.env.NEXT_PUBLIC_ADMIN_MOMO ??
  process.env.NEXT_PUBLIC_ADMIN_PHONE?.replace(/^\+233/, "0").replace(/^233/, "0") ??
  "0242176603";

// WhatsApp support deep-link derived from ADMIN_MOMO (client-side safe).
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
    annualPrice: 200,
    payCmd: "PAID GROWTH",
  },
  pro: {
    color: "text-cyan-400",
    bg: "bg-cyan-500/5",
    border: "border-cyan-500/30",
    glow: "shadow-cyan-500/10",
    emoji: "🔵",
    annualPrice: 500,
    payCmd: "PAID PRO",
  },
  enterprise: {
    color: "text-amber-400",
    bg: "bg-amber-500/5",
    border: "border-amber-500/30",
    glow: "shadow-amber-500/10",
    emoji: "🟣",
    annualPrice: 1000,
    payCmd: "PAID ENTERPRISE",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getEffectivePlan(user: {
  subscriptionPlan?: SubscriptionPlan;
  subscriptionExpiresAt?: string | null;
  referralUnlockExpiresAt?: string | null;
}): SubscriptionPlan {
  const plan = user.subscriptionPlan ?? "free";
  const now = new Date();

  // 1. Active paid plan
  if (plan !== "free") {
    const expiresAt = user.subscriptionExpiresAt;
    if (!expiresAt || new Date(expiresAt) > now) return plan;
    // Paid plan expired — fall through to check referral unlock
  }

  // 2. Referral milestone unlock — 30 referrals this month → Growth until month end
  const unlockExpiry = user.referralUnlockExpiresAt;
  if (unlockExpiry && new Date(unlockExpiry) > now) return "growth";

  return "free";
}

/** True when the user is on Growth purely because of the referral milestone unlock */
function isOnReferralUnlock(user: {
  subscriptionPlan?: SubscriptionPlan;
  referralUnlockExpiresAt?: string | null;
}): boolean {
  const plan = user.subscriptionPlan ?? "free";
  if (plan !== "free") return false; // has a real paid plan
  const unlockExpiry = user.referralUnlockExpiresAt;
  return !!(unlockExpiry && new Date(unlockExpiry) > new Date());
}

function formatExpiry(isoDate?: string | null): string {
  if (!isoDate) return "";
  return new Date(isoDate).toLocaleDateString("en-GH", {
    day: "numeric", month: "long", year: "numeric",
  });
}

// ── Components ────────────────────────────────────────────────────────────────

function daysRemaining(isoDate?: string | null): number | null {
  if (!isoDate) return null;
  const diff = new Date(isoDate).getTime() - Date.now();
  return diff > 0 ? Math.ceil(diff / (1000 * 60 * 60 * 24)) : 0;
}

function CurrentPlanCard({ plan, expiresAt, messageCount, resetKey }: {
  plan: SubscriptionPlan;
  expiresAt?: string | null;
  messageCount: number;
  resetKey?: string | null;
}) {
  const tier = SUBSCRIPTION_TIERS[plan];
  const meta = PLAN_META[plan];

  const limitPeriodLabel = tier.limitPeriod === "daily" ? "today" : tier.limitPeriod === "monthly" ? "this month" : null;
  const usedOf   = tier.messageLimit != null ? `${messageCount} / ${tier.messageLimit}` : null;
  const pctUsed  = tier.messageLimit ? Math.min(100, Math.round((messageCount / tier.messageLimit) * 100)) : 0;
  const daysLeft = daysRemaining(expiresAt);

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
          Valid until{" "}
          <span className="font-semibold text-foreground">{formatExpiry(expiresAt)}</span>
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
            <span className="font-semibold text-foreground">{usedOf}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                pctUsed >= 90 ? "bg-rose-500" : pctUsed >= 70 ? "bg-amber-500" : "bg-primary"
              }`}
              style={{ width: `${pctUsed}%` }}
            />
          </div>
          {pctUsed >= 90 && (
            <p className="mt-1.5 text-xs text-rose-400 font-medium">
              {pctUsed >= 100 ? "⛔ Limit reached — upgrade to continue" : `⚠️ ${100 - pctUsed}% remaining — upgrade soon`}
            </p>
          )}
          {pctUsed >= 70 && pctUsed < 90 && (
            <p className="mt-1.5 text-xs text-amber-400">⚠️ Running low — consider upgrading</p>
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
          Upgrade anytime to unlock unlimited entries, monthly reports, and AI insights.
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

function TierCard({ plan, isCurrentPlan, onCopy }: {
  plan: SubscriptionPlan;
  isCurrentPlan: boolean;
  onCopy: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const tier = SUBSCRIPTION_TIERS[plan];
  const meta = PLAN_META[plan];

  if (plan === "free") return null; // free is shown in CurrentPlanCard; don't duplicate

  return (
    <div
      className={`rounded-3xl border p-5 transition-all duration-300 ${meta.border} ${meta.bg} ${
        isCurrentPlan ? `shadow-xl ${meta.glow}` : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base">{meta.emoji}</span>
            <h3 className={`text-lg font-black ${meta.color}`}>{tier.brand}</h3>
            {isCurrentPlan && <Badge variant="success" className="text-[10px]">Current</Badge>}
            {plan === "pro" && !isCurrentPlan && (
              <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-bold text-cyan-400">
                ⭐ Most Popular
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{tier.label}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-2xl font-black ${meta.color}`}>
            GHS {tier.priceGHS}
            <span className="text-xs font-normal text-muted-foreground">/mo</span>
          </p>
          {meta.annualPrice && (
            <p className="text-[11px] text-muted-foreground">
              GHS {meta.annualPrice}/yr
              <span className="ml-1 text-emerald-400">(2 months free)</span>
            </p>
          )}
        </div>
      </div>

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

      {/* Feature list — collapsible */}
      <ul className={`mt-3 space-y-2 overflow-hidden transition-all duration-300 ${expanded ? "" : "max-h-[120px]"}`}>
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <CheckCircle2 className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.color}`} />
            <span className="text-xs leading-5 text-muted-foreground">{f}</span>
          </li>
        ))}
      </ul>

      <button
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
      {!isCurrentPlan && meta.payCmd && (
        <div className="mt-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4">
          <p className="text-xs text-muted-foreground mb-2">
            To upgrade, pay via MoMo then send this to ZURIA on WhatsApp:
          </p>
          <div className="flex items-center gap-2">
            <code className={`flex-1 rounded-xl bg-white/[0.06] px-3 py-2 font-mono text-sm font-bold ${meta.color}`}>
              {meta.payCmd}
            </code>
            <button
              onClick={() => onCopy(meta.payCmd)}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] hover:bg-white/[0.1] transition-colors"
            >
              <Copy className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
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
  const { user } = useAppStore();
  const [copied, setCopied] = useState<string | null>(null);

  const effectivePlan: SubscriptionPlan = user ? getEffectivePlan(user) : "free";
  const referralUnlock = user ? isOnReferralUnlock(user) : false;
  const messageCount = user?.whatsappMessageCount ?? 0;
  const expiresAt = referralUnlock ? user?.referralUnlockExpiresAt : user?.subscriptionExpiresAt;
  const resetKey = user?.whatsappMessageResetKey;

  const plans: SubscriptionPlan[] = ["growth", "pro", "enterprise"];

  function copyText(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <p className="text-sm text-primary">Account</p>
        <h1 className="mt-1 text-3xl font-black">Subscription & Plan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ZURIA is the AI memory system for your business — scales from a single kiosk to a full enterprise.
        </p>
      </div>

      {/* Current plan */}
      <CurrentPlanCard
        plan={effectivePlan}
        expiresAt={expiresAt}
        messageCount={messageCount}
        resetKey={resetKey}
      />

      {/* Referral unlock badge — shown when Growth is active via the 30-referral milestone */}
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

      {/* Upgrade headline */}
      {effectivePlan === "free" && (
        <>
          <GlassCard className="border-primary/15 bg-primary/5">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-bold">Move from recording… to understanding.</h3>
                <p className="mt-1 text-sm text-muted-foreground leading-6">
                  Free gives you the foundation. Paid plans unlock AI forecasting, auto reminders, monthly reports,
                  staff accounts, and the intelligence that makes ZURIA a true business advisor — not just a ledger.
                </p>
              </div>
            </div>
          </GlassCard>

          {/* Free path: Refer & Earn to unlock Growth */}
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
                  <p className="text-xs text-muted-foreground mt-0.5">Refer 30 people in one calendar month and unlock ZURIA Growth — monthly reports, AI insights, debt reminders, inventory alerts — completely free until month end. Worth GHS 20!</p>
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

      {effectivePlan !== "free" && effectivePlan !== "enterprise" && (
        <GlassCard className="border-cyan-500/15 bg-cyan-500/5">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/10">
              <CrownIcon className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h3 className="font-bold">Ready to go further?</h3>
              <p className="mt-1 text-sm text-muted-foreground leading-6">
                Upgrade to unlock AI cash-flow forecasting, staff accounts, unlimited entries,
                advanced analytics, and the full ZURIA intelligence engine.
              </p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Locked features callout — shown for free users only */}
      {effectivePlan === "free" && (
        <GlassCard className="border-rose-500/15 bg-rose-500/[0.03]">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-400 mb-3">🔒 Features locked on your current plan</p>
          <ul className="space-y-2">
            {[
              { icon: "📅", label: "Monthly profit & loss report", plan: "Growth" },
              { icon: "📊", label: "Expense category breakdown", plan: "Growth" },
              { icon: "🔔", label: "Auto debt reminders via WhatsApp", plan: "Growth" },
              { icon: "📦", label: "Low-stock WhatsApp alerts", plan: "Growth" },
              { icon: "🤖", label: "AI business coach & cash-flow forecasting", plan: "Pro" },
              { icon: "👥", label: "Staff accounts & role-based access", plan: "Pro" },
            ].map(({ icon, label, plan: requiredPlan }) => (
              <li key={label} className="flex items-center gap-2.5">
                <span className="text-base shrink-0">{icon}</span>
                <span className="flex-1 text-xs text-muted-foreground">{label}</span>
                <span className={`text-[10px] font-bold shrink-0 px-2 py-0.5 rounded-full ${
                  requiredPlan === "Growth"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                }`}>
                  {requiredPlan}+
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Upgrade below — or refer friends for free Growth access.
          </p>
        </GlassCard>
      )}

      {/* Annual deal banner */}
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
        <BadgeCheck className="h-5 w-5 shrink-0 text-emerald-400" />
        <p className="text-sm text-emerald-300 font-medium">
          Pay annually and get <strong>2 months free</strong> — save up to GHS 200/year.
        </p>
      </div>

      {/* Plan cards */}
      <div className="space-y-4">
        {plans.map((p) => (
          <TierCard
            key={p}
            plan={p}
            isCurrentPlan={effectivePlan === p}
            onCopy={copyText}
          />
        ))}
      </div>

      {/* MoMo payment guide */}
      <GlassCard>
        <h3 className="flex items-center gap-2 font-bold">
          <span className="text-xl">📱</span> How to pay with Mobile Money
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          No card needed. Send directly from your MoMo wallet and get activated within 1 hour.
        </p>

        <div className="mt-4 space-y-3">
          {[
            { network: "MTN MoMo", code: "*170#", instruction: "Send Money" },
            { network: "AirtelTigo Money", code: "*110#", instruction: "Make Payment" },
            { network: "Vodafone Cash", code: "*110#", instruction: "Send Money" },
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
                {copied === ADMIN_MOMO ? "Copied!" : ADMIN_MOMO}
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Steps</p>
          {[
            "Pay the amount for your chosen plan via MoMo",
            "Use your WhatsApp number as the payment reference",
            "Open WhatsApp and message ZURIA: PAID GROWTH, PAID PRO, or PAID ENTERPRISE",
            "We verify your payment and activate within 1 hour",
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3 mb-2 last:mb-0">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-black text-primary">
                {i + 1}
              </span>
              <p className="text-xs text-muted-foreground leading-5">{step}</p>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Feature comparison — full capability matrix */}
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
              {/* ── Limits & Recording ── */}
              <tr><td colSpan={5} className="pt-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-primary/70">Limits &amp; Recording</td></tr>
              {[
                ["Daily AI entries", "10/day", "200/mo", "∞", "∞"],
                ["Voice / text recording via WhatsApp", "✅", "✅", "✅", "✅"],
                ["Sales & expense tracking", "✅", "✅", "✅", "✅"],
                ["Multi-currency support", "✅", "✅", "✅", "✅"],
                ["Offline-first (sync when online)", "✅", "✅", "✅", "✅"],
              ].map(([f, ...v]) => <CompRow key={f} f={f} v={v} />)}

              {/* ── Reports ── */}
              <tr><td colSpan={5} className="pt-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-primary/70">Reports</td></tr>
              {[
                ["Daily end-of-day summary (WhatsApp)", "✅", "✅", "✅", "✅"],
                ["Weekly SMS-style report", "✅", "✅", "✅", "✅"],
                ["Monthly P&L report", "—", "✅", "✅", "✅"],
                ["PDF / printable report download", "—", "✅", "✅", "✅"],
                ["Full business dashboard", "—", "—", "✅", "✅"],
                ["Executive KPI dashboard", "—", "—", "—", "✅"],
              ].map(([f, ...v]) => <CompRow key={f} f={f} v={v} />)}

              {/* ── Finance & Debt ── */}
              <tr><td colSpan={5} className="pt-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-primary/70">Finance &amp; Debt</td></tr>
              {[
                ["Debt & customer credit tracking", "✅", "✅", "✅", "✅"],
                ["Expense category breakdown", "—", "✅", "✅", "✅"],
                ["Automated debt reminder messages", "—", "✅", "✅", "✅"],
                ["Cash-flow health score", "—", "✅", "✅", "✅"],
                ["AI cash-flow forecasting", "—", "—", "✅", "✅"],
                ["Profit margin analysis by product", "—", "—", "✅", "✅"],
              ].map(([f, ...v]) => <CompRow key={f} f={f} v={v} />)}

              {/* ── Inventory ── */}
              <tr><td colSpan={5} className="pt-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-primary/70">Inventory</td></tr>
              {[
                ["Basic stock tracking", "✅", "✅", "✅", "✅"],
                ["Low-stock WhatsApp alerts", "—", "✅", "✅", "✅"],
                ["Supplier management", "—", "—", "✅", "✅"],
                ["Auto reorder suggestions", "—", "—", "✅", "✅"],
                ["Multi-branch stock sync", "—", "—", "—", "✅"],
              ].map(([f, ...v]) => <CompRow key={f} f={f} v={v} />)}

              {/* ── AI Intelligence ── */}
              <tr><td colSpan={5} className="pt-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-primary/70">AI Intelligence</td></tr>
              {[
                ["Local language support (Twi, Ga, Ewe…)", "✅", "✅", "✅", "✅"],
                ["Contextual AI tips & insights", "—", "✅", "✅", "✅"],
                ["AI business coach (on-demand)", "—", "—", "✅", "✅"],
                ["AI growth strategy recommendations", "—", "—", "✅", "✅"],
                ["Predictive sales & demand AI", "—", "—", "—", "✅"],
                ["Competitive intelligence alerts", "—", "—", "—", "✅"],
              ].map(([f, ...v]) => <CompRow key={f} f={f} v={v} />)}

              {/* ── Operations & Team ── */}
              <tr><td colSpan={5} className="pt-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-primary/70">Operations &amp; Team</td></tr>
              {[
                ["Staff / employee accounts", "—", "—", "✅", "✅"],
                ["Role-based access control", "—", "—", "✅", "✅"],
                ["Customer loyalty tracking", "—", "—", "✅", "✅"],
                ["WhatsApp commerce layer", "—", "—", "✅", "✅"],
                ["Multi-branch management", "—", "—", "—", "✅"],
                ["API access for integrations", "—", "—", "—", "✅"],
              ].map(([f, ...v]) => <CompRow key={f} f={f} v={v} />)}

              {/* ── Support ── */}
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
          <a
            href={SUPPORT_WA_HREF}
            target="_blank"
            rel="noopener noreferrer"
          >
            Chat with us on WhatsApp <ArrowRight className="h-4 w-4" />
          </a>
        </Button>
      </GlassCard>
    </div>
  );
}
