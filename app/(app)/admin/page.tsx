"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Users, Store, ReceiptText, RefreshCw, Smartphone, Globe,
  ArrowDownToLine, Check, X, AlertTriangle, Info, TrendingUp,
  CreditCard, BadgeCheck, ChevronRight, Crown, Zap,
  ShieldCheck, Activity, DollarSign, Server, MessageSquare, Eye,
} from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/app-store";
import { useAuth } from "@/providers/auth-provider";
import { formatMoney } from "@/lib/utils";
import { SUBSCRIPTION_TIERS, TRANSACTION_TYPE_LABELS, type SubscriptionPlan, type WithdrawalRequest } from "@/types/domain";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminUser {
  id: string;
  ownerName: string;
  phoneNumber: string;         // masked
  rawPhone: string;            // full phone
  onboardingComplete: boolean;
  businessId: string | null;
  preferredLanguage: string;
  subscriptionPlan: string;
  subscriptionExpiresAt: string | null;
  referralCode: string | null;
  referralBalance: number;
  referralCount: number;
  whatsappMessageCount: number;
  createdAt: string | null;
}

interface AdminTxn {
  id: string;
  businessId: string;
  type: string;
  amount: number;
  rawText: string;
  customerName: string | null;
  productName: string | null;
  source: string;
  confidence: number | null;
  createdAt: string | null;
}

interface AdminClaim {
  id: string;
  userId: string;
  ownerName: string;
  phone: string;
  plan: SubscriptionPlan;
  annual: boolean;
  amount: number;
  status: string;
  businessName: string;
  claimedAt: string | null;
}

interface AdminErrorLog {
  id: string;
  context: string;
  message: string;
  phone: string | null;
  severity: "error" | "warn";
  createdAt: string | null;
}

interface AdminStats {
  totals: {
    users: number;
    businesses: number;
    transactions: number;
    revenueGHS: number;
    revenueCount: number;
  };
  planBreakdown: {
    free: number;
    growth: number;
    pro: number;
    enterprise: number;
  };
  users: AdminUser[];
  transactions: AdminTxn[];
  withdrawals: WithdrawalRequest[];
  paymentClaims: AdminClaim[];
  errors: AdminErrorLog[];
}

type TabId = "overview" | "users" | "claims" | "withdrawals" | "transactions" | "errors";

// ─── Toast ────────────────────────────────────────────────────────────────────

interface Toast {
  id: string;
  type: "success" | "error";
  message: string;
}

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((type: Toast["type"], message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);
  const dismiss = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);
  return { toasts, push, dismiss };
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-white/[0.06] ${className}`} />;
}

function SkeletonStatCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[...Array(4)].map((_, i) => (
        <GlassCard key={i}>
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-6 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GH", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GH", { month: "short", day: "numeric", year: "numeric" });
}

const PLAN_COLOURS: Record<string, string> = {
  free:       "bg-white/[0.06] text-muted-foreground",
  growth:     "bg-emerald-500/15 text-emerald-400",
  pro:        "bg-indigo-500/15 text-indigo-400",
  enterprise: "bg-amber-500/15 text-amber-400",
};

const PLAN_ICONS: Record<string, React.ElementType> = {
  free:       Zap,
  growth:     TrendingUp,
  pro:        Crown,
  enterprise: ShieldCheck,
};

function PlanBadge({ plan }: { plan: string }) {
  const Icon = PLAN_ICONS[plan] ?? Zap;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${PLAN_COLOURS[plan] ?? "bg-white/[0.06] text-muted-foreground"}`}>
      <Icon className="h-3 w-3" />
      {plan}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user } = useAppStore();
  const { firebaseUser } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  // Per-row action state: maps id → "approve" | "reject" | "activate" | null
  const [actionState, setActionState] = useState<Record<string, string>>({});
  // Subscription activation form state: maps userId → { plan, durationDays }
  const [activateForms, setActivateForms] = useState<Record<string, { plan: SubscriptionPlan; days: number }>>({});

  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  const adminPhone = process.env.NEXT_PUBLIC_ADMIN_PHONE ?? "";
  const myPhone = firebaseUser?.phoneNumber ?? user?.phoneNumber ?? "";
  const isAdmin = !!(adminPhone && myPhone === adminPhone);

  const getToken = useCallback(async () => {
    return (await firebaseUser?.getIdToken()) ?? "";
  }, [firebaseUser]);

  const load = useCallback(async (isRefresh = false) => {
    if (!isAdmin) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch("/api/admin/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setStats(data as AdminStats);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Could not load admin data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isAdmin, getToken, pushToast]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [isAdmin]);

  // ── Withdrawal action ──────────────────────────────────────────────────────
  async function handleWithdrawal(id: string, action: "approve" | "reject") {
    if (actionState[id]) return;
    setActionState((prev) => ({ ...prev, [id]: action }));
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/withdrawals/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        pushToast("error", data.error ?? `Failed to ${action} withdrawal`);
        return;
      }
      pushToast("success", action === "approve" ? "Withdrawal approved — payment sent!" : "Withdrawal rejected — balance restored");
      await load(true);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setActionState((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }
  }

  // ── Subscription activation ────────────────────────────────────────────────
  async function handleActivate(userId: string, plan: SubscriptionPlan, durationDays: number, claimId?: string) {
    const key = claimId ?? userId;
    if (actionState[key]) return;
    setActionState((prev) => ({ ...prev, [key]: "activate" }));
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/subscriptions/${userId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ plan, durationDays, claimId }),
      });
      const data = await res.json();
      if (!res.ok) {
        pushToast("error", data.error ?? "Failed to activate subscription");
        return;
      }
      pushToast("success", `${plan.charAt(0).toUpperCase() + plan.slice(1)} plan activated — user notified on WhatsApp ✅`);
      setActivateForms((prev) => { const next = { ...prev }; delete next[userId]; return next; });
      await load(true);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Failed to activate");
    } finally {
      setActionState((prev) => { const next = { ...prev }; delete next[key]; return next; });
    }
  }

  if (!user) return null;

  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center space-y-2">
          <ShieldCheck className="mx-auto h-12 w-12 text-muted-foreground/40" />
          <p className="text-2xl font-black">Access denied</p>
          <p className="text-sm text-muted-foreground">This page is for administrators only.</p>
        </div>
      </div>
    );
  }

  const tabs: { id: TabId; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: "overview",      label: "Overview",     icon: Activity },
    { id: "users",         label: "Users",        icon: Users,         badge: stats?.totals.users },
    { id: "claims",        label: "Claims",       icon: CreditCard,    badge: stats?.paymentClaims.length },
    { id: "withdrawals",   label: "Withdrawals",  icon: ArrowDownToLine, badge: stats?.withdrawals.filter((w) => w.status === "pending" || w.status === "processing").length },
    { id: "transactions",  label: "Transactions", icon: ReceiptText },
    { id: "errors",        label: "Errors",       icon: AlertTriangle, badge: stats?.errors.length },
  ];

  return (
    <div className="space-y-6">

      {/* ── Toasts ── */}
      <div className="fixed bottom-6 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => dismissToast(t.id)}
            className={`pointer-events-auto flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold shadow-xl cursor-pointer transition-all duration-300 ${
              t.type === "success"
                ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300"
                : "bg-destructive/20 border border-destructive/30 text-destructive"
            }`}
          >
            {t.type === "success"
              ? <Check className="h-4 w-4 shrink-0" />
              : <AlertTriangle className="h-4 w-4 shrink-0" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-primary">System overview</p>
          <h1 className="mt-1 text-3xl font-black">Admin Panel</h1>
        </div>
        <Button
          variant="outline" size="sm"
          onClick={() => load(true)}
          disabled={loading || refreshing}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-all ${
                isActive
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${
                  isActive ? "bg-primary/30 text-primary" : "bg-white/[0.08] text-muted-foreground"
                }`}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === "overview" && (
        <div className="space-y-6">

          {/* ── System Tools ── */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Link href="/admin/ai-monitoring">
              <GlassCard className="cursor-pointer hover:bg-white/[0.06] transition-colors group">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 group-hover:bg-emerald-500/20 transition-colors">
                    <Server className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold">AI System Monitor</p>
                    <p className="text-xs text-muted-foreground">Infrastructure health &amp; latency</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </GlassCard>
            </Link>
            <Link href="/admin/ai-console">
              <GlassCard className="cursor-pointer hover:bg-white/[0.06] transition-colors group">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
                    <MessageSquare className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold">System Intelligence Console</p>
                    <p className="text-xs text-muted-foreground">Groq-powered operational AI</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </GlassCard>
            </Link>
            <Link href="/admin/billing">
              <GlassCard className="cursor-pointer hover:bg-white/[0.06] transition-colors group">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 group-hover:bg-emerald-500/20 transition-colors">
                    <CreditCard className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold">Billing Dashboard</p>
                    <p className="text-xs text-muted-foreground">Payments, recovery, webhooks</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </GlassCard>
            </Link>
            <Link href="/admin/observability">
              <GlassCard className="cursor-pointer hover:bg-white/[0.06] transition-colors group">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 group-hover:bg-amber-500/20 transition-colors">
                    <Eye className="h-5 w-5 text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold">Observability Center</p>
                    <p className="text-xs text-muted-foreground">Errors, AI costs, queue failures</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </GlassCard>
            </Link>
          </div>

          {/* Stat cards */}
          {loading ? <SkeletonStatCards /> : stats ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard icon={Users}       label="Total users"    value={stats.totals.users}        color="text-primary" />
                <StatCard icon={Store}       label="Businesses"     value={stats.totals.businesses}   color="text-indigo-400" />
                <StatCard icon={ReceiptText} label="Transactions"   value={stats.totals.transactions} color="text-emerald-400" />
                <StatCard
                  icon={DollarSign}
                  label="Revenue collected"
                  value={`GH₵ ${stats.totals.revenueGHS.toFixed(2)}`}
                  subLabel={`${stats.totals.revenueCount} paid activations`}
                  color="text-amber-400"
                />
              </div>

              {/* Plan breakdown */}
              <GlassCard>
                <h2 className="mb-4 font-bold text-sm">Subscription breakdown</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(["free", "growth", "pro", "enterprise"] as SubscriptionPlan[]).map((plan) => {
                    const count = stats.planBreakdown[plan];
                    const total = stats.totals.users || 1;
                    const pct = Math.round((count / total) * 100);
                    const tier = SUBSCRIPTION_TIERS[plan];
                    const Icon = PLAN_ICONS[plan];
                    return (
                      <div key={plan} className="rounded-xl bg-white/[0.03] p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Icon className={`h-4 w-4 ${PLAN_COLOURS[plan]?.split(" ")[1] ?? "text-muted-foreground"}`} />
                          <p className="text-xs font-semibold capitalize">{tier.brand}</p>
                        </div>
                        <p className="text-2xl font-black">{count}</p>
                        <div className="h-1.5 rounded-full bg-white/[0.06]">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${
                              plan === "enterprise" ? "bg-amber-400" :
                              plan === "pro" ? "bg-indigo-400" :
                              plan === "growth" ? "bg-emerald-400" : "bg-white/20"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground">{pct}% of users</p>
                      </div>
                    );
                  })}
                </div>
              </GlassCard>

              {/* Quick alerts */}
              {(stats.paymentClaims.length > 0 || stats.withdrawals.some((w) => w.status === "pending")) && (
                <GlassCard>
                  <h2 className="mb-3 font-bold text-sm flex items-center gap-2">
                    <Activity className="h-4 w-4 text-amber-400" />
                    Needs attention
                  </h2>
                  <div className="space-y-2">
                    {stats.paymentClaims.length > 0 && (
                      <button
                        onClick={() => setActiveTab("claims")}
                        className="flex w-full items-center justify-between rounded-xl bg-amber-500/[0.07] border border-amber-500/20 px-3 py-2.5 text-left hover:bg-amber-500/[0.12] transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4 text-amber-400" />
                          <span className="text-sm font-semibold text-amber-300">
                            {stats.paymentClaims.length} pending payment {stats.paymentClaims.length === 1 ? "claim" : "claims"}
                          </span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-amber-400" />
                      </button>
                    )}
                    {stats.withdrawals.filter((w) => w.status === "pending").length > 0 && (
                      <button
                        onClick={() => setActiveTab("withdrawals")}
                        className="flex w-full items-center justify-between rounded-xl bg-primary/[0.07] border border-primary/20 px-3 py-2.5 text-left hover:bg-primary/[0.12] transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <ArrowDownToLine className="h-4 w-4 text-primary" />
                          <span className="text-sm font-semibold text-primary">
                            {stats.withdrawals.filter((w) => w.status === "pending").length} pending withdrawal{stats.withdrawals.filter((w) => w.status === "pending").length !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-primary" />
                      </button>
                    )}
                  </div>
                </GlassCard>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* ── USERS TAB ── */}
      {activeTab === "users" && (
        <GlassCard>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold">All users ({stats?.totals.users ?? "…"})</h2>
            {refreshing && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          {loading ? <SkeletonRows count={8} /> : !stats?.users.length ? (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <div className="space-y-2">
              {stats.users.map((u) => {
                const showForm = !!activateForms[u.id];
                const form = activateForms[u.id] ?? { plan: "growth" as SubscriptionPlan, days: 30 };
                const isActivating = actionState[u.id] === "activate";
                const isExpired = u.subscriptionExpiresAt
                  ? new Date(u.subscriptionExpiresAt) < new Date()
                  : false;

                return (
                  <div key={u.id} className="rounded-xl bg-white/[0.03] border border-white/[0.04]">
                    {/* User row */}
                    <div className="flex items-start justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold">{u.ownerName}</p>
                          <PlanBadge plan={u.subscriptionPlan} />
                          {!u.onboardingComplete && (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">Incomplete</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{u.phoneNumber}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Globe className="h-2.5 w-2.5" />{u.preferredLanguage}
                          </span>
                          {u.subscriptionExpiresAt && (
                            <span className={`text-[10px] ${isExpired ? "text-destructive" : "text-muted-foreground"}`}>
                              {isExpired ? "⚠ Expired" : "Expires"} {fmtDateShort(u.subscriptionExpiresAt)}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            Joined {fmtDateShort(u.createdAt)}
                          </span>
                          {u.whatsappMessageCount > 0 && (
                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <Smartphone className="h-2.5 w-2.5" />{u.whatsappMessageCount} msgs
                            </span>
                          )}
                          {u.referralCount > 0 && (
                            <span className="text-[10px] text-emerald-400">
                              {u.referralCount} referrals · GH₵ {u.referralBalance.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {u.subscriptionPlan !== "enterprise" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              if (showForm) {
                                setActivateForms((prev) => { const n = { ...prev }; delete n[u.id]; return n; });
                              } else {
                                setActivateForms((prev) => ({ ...prev, [u.id]: { plan: "growth", days: 30 } }));
                              }
                            }}
                          >
                            {showForm ? "Cancel" : "Activate plan"}
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Inline activation form */}
                    {showForm && (
                      <div className="border-t border-white/[0.04] px-3 py-3 bg-white/[0.02]">
                        <p className="text-xs font-semibold text-primary mb-2">Activate subscription for {u.ownerName}</p>
                        <div className="flex flex-wrap gap-2 items-end">
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Plan</p>
                            <select
                              value={form.plan}
                              onChange={(e) => setActivateForms((prev) => ({
                                ...prev,
                                [u.id]: { ...prev[u.id]!, plan: e.target.value as SubscriptionPlan },
                              }))}
                              className="rounded-lg bg-white/[0.06] border border-white/[0.08] px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                            >
                              <option value="growth">Growth — GH₵20/mo</option>
                              <option value="pro">Pro — GH₵50/mo</option>
                              <option value="enterprise">Enterprise — GH₵100/mo</option>
                            </select>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Duration</p>
                            <select
                              value={form.days}
                              onChange={(e) => setActivateForms((prev) => ({
                                ...prev,
                                [u.id]: { ...prev[u.id]!, days: Number(e.target.value) },
                              }))}
                              className="rounded-lg bg-white/[0.06] border border-white/[0.08] px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                            >
                              <option value={7}>7 days</option>
                              <option value={30}>30 days (monthly)</option>
                              <option value={90}>90 days (quarterly)</option>
                              <option value={365}>365 days (annual)</option>
                            </select>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleActivate(u.id, form.plan, form.days)}
                            disabled={isActivating}
                            className="h-8 gap-1.5"
                          >
                            {isActivating
                              ? <><RefreshCw className="h-3 w-3 animate-spin" /> Activating…</>
                              : <><BadgeCheck className="h-3 w-3" /> Activate</>}
                          </Button>
                        </div>
                        <p className="mt-2 text-[10px] text-muted-foreground">
                          User will be notified on WhatsApp automatically.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>
      )}

      {/* ── PAYMENT CLAIMS TAB ── */}
      {activeTab === "claims" && (
        <GlassCard>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-amber-400" />
              <h2 className="font-bold">Pending payment claims</h2>
              {(stats?.paymentClaims.length ?? 0) > 0 && (
                <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-400">
                  {stats!.paymentClaims.length}
                </span>
              )}
            </div>
            {refreshing && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {loading ? <SkeletonRows count={4} /> : !stats?.paymentClaims.length ? (
            <div className="flex items-center gap-2 text-sm text-primary">
              <BadgeCheck className="h-4 w-4" />
              <p>No pending claims — all clear! ✅</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                These users sent <code className="rounded bg-white/[0.06] px-1">PAID [PLAN]</code> on WhatsApp.
                Verify their MoMo payment in your dashboard, then activate their plan below.
              </p>
              {stats.paymentClaims.map((claim) => {
                const isActivating = actionState[claim.id] === "activate";
                const form = activateForms[claim.id] ?? { plan: claim.plan, days: claim.annual ? 365 : 30 };
                return (
                  <div key={claim.id} className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05]">
                    <div className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-bold">{claim.ownerName}</p>
                            <PlanBadge plan={claim.plan} />
                            {claim.annual && (
                              <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-bold text-indigo-400">Annual</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{claim.phone} · {claim.businessName}</p>
                          <div className="flex flex-wrap gap-x-3 mt-1">
                            <span className="text-xs font-semibold text-amber-300">
                              Expected: GH₵ {claim.amount.toFixed(2)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Claimed: {fmtDate(claim.claimedAt)}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">Claim ID: {claim.id}</p>
                        </div>
                      </div>

                      {/* Activation controls */}
                      <div className="mt-3 pt-3 border-t border-amber-500/15 flex flex-wrap gap-2 items-end">
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-1">Plan to activate</p>
                          <select
                            value={form.plan}
                            onChange={(e) => setActivateForms((prev) => ({
                              ...prev,
                              [claim.id]: { ...prev[claim.id] ?? form, plan: e.target.value as SubscriptionPlan },
                            }))}
                            className="rounded-lg bg-black/30 border border-amber-500/20 px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-400/50"
                          >
                            <option value="growth">Growth — GH₵20</option>
                            <option value="pro">Pro — GH₵50</option>
                            <option value="enterprise">Enterprise — GH₵100</option>
                          </select>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-1">Duration</p>
                          <select
                            value={form.days}
                            onChange={(e) => setActivateForms((prev) => ({
                              ...prev,
                              [claim.id]: { ...prev[claim.id] ?? form, days: Number(e.target.value) },
                            }))}
                            className="rounded-lg bg-black/30 border border-amber-500/20 px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-400/50"
                          >
                            <option value={30}>30 days (monthly)</option>
                            <option value={365}>365 days (annual)</option>
                          </select>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleActivate(claim.userId, form.plan, form.days, claim.id)}
                          disabled={isActivating}
                          className="h-8 gap-1.5 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border-amber-500/30"
                          variant="outline"
                        >
                          {isActivating
                            ? <><RefreshCw className="h-3 w-3 animate-spin" /> Activating…</>
                            : <><BadgeCheck className="h-3 w-3" /> Verify &amp; Activate</>}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>
      )}

      {/* ── WITHDRAWALS TAB ── */}
      {activeTab === "withdrawals" && (
        <GlassCard>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ArrowDownToLine className="h-4 w-4 text-primary" />
              <h2 className="font-bold">Withdrawal requests</h2>
              {(stats?.withdrawals.filter((w) => w.status === "pending" || w.status === "processing").length ?? 0) > 0 && (
                <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-400">
                  {stats!.withdrawals.filter((w) => w.status === "pending" || w.status === "processing").length}
                </span>
              )}
            </div>
            {refreshing && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {loading ? <SkeletonRows count={3} /> : !stats?.withdrawals.length ? (
            <p className="text-sm text-muted-foreground">No pending requests. All clear! ✅</p>
          ) : (
            <div className="space-y-3">
              {stats.withdrawals.map((w) => {
                const isApproving = actionState[w.id] === "approve";
                const isRejecting = actionState[w.id] === "reject";
                const isBusy = !!(actionState[w.id]);
                const isProcessing = w.status === "processing";

                return (
                  <div key={w.id} className={`rounded-xl border px-4 py-3 ${
                    isProcessing
                      ? "bg-indigo-500/[0.05] border-indigo-500/20"
                      : "bg-white/[0.03] border-white/[0.05]"
                  }`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold">{formatMoney(w.amount)}</p>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                            w.status === "processing"
                              ? "bg-indigo-500/15 text-indigo-400"
                              : "bg-amber-500/15 text-amber-400"
                          }`}>
                            {w.status}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{w.ownerName} · {w.phoneNumber}</p>
                        <p className="text-xs text-muted-foreground">
                          {w.method === "momo" ? `${w.network ?? "MoMo"}` : "Bank"} · {w.accountNumber} · {w.accountName}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Requested {fmtDate(w.createdAt)}</p>
                        {w.paystackTransferCode && (
                          <p className="text-[10px] text-indigo-400 mt-0.5 font-mono">Paystack: {w.paystackTransferCode}</p>
                        )}
                      </div>

                      {(w.status === "pending" || w.status === "processing") && (
                        <div className="flex flex-col gap-1.5 shrink-0">
                          <Button
                            size="sm"
                            onClick={() => handleWithdrawal(w.id, "approve")}
                            disabled={isBusy}
                            className="h-8 gap-1.5 bg-green-500/20 text-green-400 hover:bg-green-500/30 border-green-500/30"
                            variant="outline"
                          >
                            {isApproving
                              ? <><RefreshCw className="h-3 w-3 animate-spin" /> Sending…</>
                              : <><Check className="h-3 w-3" /> Pay</>}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleWithdrawal(w.id, "reject")}
                            disabled={isBusy}
                            className="h-8 gap-1.5"
                          >
                            {isRejecting
                              ? <><RefreshCw className="h-3 w-3 animate-spin" /> Rejecting…</>
                              : <><X className="h-3 w-3" /> Reject</>}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>
      )}

      {/* ── TRANSACTIONS TAB ── */}
      {activeTab === "transactions" && (
        <GlassCard>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold">Recent transactions — all businesses</h2>
            {refreshing && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          {loading ? <SkeletonRows count={10} /> : !stats?.transactions.length ? (
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            <div className="space-y-1.5">
              {stats.transactions.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2.5 gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        {(TRANSACTION_TYPE_LABELS as Record<string, string>)[t.type] ?? t.type}
                      </p>
                      {t.source === "whatsapp" && (
                        <span className="flex items-center gap-0.5 shrink-0 text-[10px] text-green-400 font-semibold">
                          <Smartphone className="h-2.5 w-2.5" />WA
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {t.rawText || [t.customerName, t.productName].filter(Boolean).join(" · ") || t.businessId}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{fmtDate(t.createdAt)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold">{formatMoney(t.amount)}</p>
                    {t.confidence !== null && (
                      <p className={`text-[10px] ${t.confidence < 0.6 ? "text-amber-400" : "text-muted-foreground"}`}>
                        {Math.round(t.confidence * 100)}% conf
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      )}

      {/* ── ERRORS TAB ── */}
      {activeTab === "errors" && (
        <GlassCard>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <h2 className="font-bold">Error log</h2>
              {(stats?.errors.length ?? 0) > 0 && (
                <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-bold text-destructive">
                  {stats!.errors.length}
                </span>
              )}
            </div>
            {refreshing && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {loading ? <SkeletonRows count={5} /> : !stats?.errors.length ? (
            <div className="flex items-center gap-2 text-sm text-primary">
              <Info className="h-4 w-4" />
              <p>No errors logged. Everything looks good! ✅</p>
            </div>
          ) : (
            <div className="space-y-2">
              {stats.errors.map((e) => (
                <div
                  key={e.id}
                  className={`rounded-xl px-3 py-2.5 ${
                    e.severity === "error"
                      ? "bg-destructive/[0.08] border border-destructive/20"
                      : "bg-amber-500/[0.07] border border-amber-500/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold uppercase rounded-full px-1.5 py-0.5 ${
                          e.severity === "error"
                            ? "bg-destructive/20 text-destructive"
                            : "bg-amber-500/20 text-amber-400"
                        }`}>
                          {e.severity}
                        </span>
                        <p className={`text-xs font-bold ${e.severity === "error" ? "text-destructive" : "text-amber-400"}`}>
                          {e.context}
                        </p>
                      </div>
                      <p className="mt-1 text-sm break-all">{e.message}</p>
                      {e.phone && (
                        <p className="mt-0.5 text-xs text-muted-foreground">Phone: {e.phone}</p>
                      )}
                    </div>
                    <p className="shrink-0 text-[10px] text-muted-foreground whitespace-nowrap">
                      {fmtDate(e.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      )}

      {/* ── Global initial loading placeholder ── */}
      {loading && !stats && activeTab !== "overview" && (
        <GlassCard>
          <div className="flex items-center gap-3 text-muted-foreground py-4">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <p className="text-sm">Loading admin data…</p>
          </div>
        </GlassCard>
      )}

    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  subLabel,
  color = "text-primary",
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  subLabel?: string;
  color?: string;
}) {
  return (
    <GlassCard>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/[0.05]">
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
        <div>
          <p className="text-2xl font-black">
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
          <p className="text-xs text-muted-foreground">{label}</p>
          {subLabel && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{subLabel}</p>}
        </div>
      </div>
    </GlassCard>
  );
}
