"use client";

import { useEffect, useState, useCallback } from "react";
import {
  CreditCard, AlertTriangle, CheckCircle, RefreshCw,
  RotateCcw, Wifi, WifiOff, Zap, Users, TrendingUp,
  Clock, XCircle, Activity,
} from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-provider";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaymentSummary {
  total: number;
  successful: number;
  pending: number;
  failed: number;
  totalRevenueGHS: number;
}

interface SubscriptionBreakdown {
  free: number;
  growth: number;
  pro: number;
  enterprise: number;
  total: number;
  activePaid: number;
}

interface WebhookQueueStats {
  pending: number;
  processing: number;
  done: number;
  dead: number;
  failed: number;
  total: number;
  oldestPendingAt: string | null;
}

interface FailedPaymentRecord {
  reference: string;
  userId: string;
  plan: string;
  amountGHS: number;
  failedAt: string;
  failureReason: string;
}

interface RecoveryCandidate {
  reference: string;
  userId: string;
  plan: string;
  amountGHS: number;
  createdAt: string;
  ageMinutes: number;
}

interface RecentActivation {
  reference: string;
  userId: string;
  plan: string;
  amountGHS: number;
  activatedAt: string;
  source: string;
}

interface DeadLetterEntry {
  id: string;
  eventType: string;
  receivedAt: string;
  failedAt: string;
  attempts: number;
  lastError: string;
  status: string;
}

interface BillingData {
  generatedAt: string;
  paymentStats: { today: PaymentSummary; thisWeek: PaymentSummary; thisMonth: PaymentSummary };
  subscriptions: SubscriptionBreakdown;
  webhookQueue: WebhookQueueStats & { deadLetters: DeadLetterEntry[] };
  failedPayments: FailedPaymentRecord[];
  recoveryCandidates: RecoveryCandidate[];
  recentActivations: RecentActivation[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(ghs: number): string {
  return `GH₵ ${ghs.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GH", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function planBadge(plan: string): string {
  const colors: Record<string, string> = {
    free: "bg-white/[0.06] text-muted-foreground",
    growth: "bg-emerald-500/15 text-emerald-400",
    pro: "bg-primary/15 text-primary",
    enterprise: "bg-amber-500/15 text-amber-400",
  };
  return colors[plan] ?? "bg-white/[0.06] text-muted-foreground";
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = "" }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] p-3 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-black ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ─── Payment Period Card ──────────────────────────────────────────────────────

function PeriodCard({ label, data }: { label: string; data: PaymentSummary }) {
  const successRate = data.total > 0 ? Math.round((data.successful / data.total) * 100) : 0;
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-black">{fmtMoney(data.totalRevenueGHS)}</p>
      <div className="flex gap-3 text-xs">
        <span className="text-emerald-400">{data.successful} ✓</span>
        <span className="text-amber-400">{data.pending} ⏳</span>
        <span className="text-red-400">{data.failed} ✗</span>
      </div>
      {data.total > 0 && (
        <div className="w-full bg-white/[0.06] rounded-full h-1.5">
          <div
            className="bg-emerald-500 h-1.5 rounded-full transition-all"
            style={{ width: `${successRate}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminBillingPage() {
  const [data,         setData]         = useState<BillingData | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [autoRefresh,  setAutoRefresh]  = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [lastFetched,  setLastFetched]  = useState<string | null>(null);

  const { firebaseUser } = useAuth();

  const getToken = useCallback(async () => {
    return (await firebaseUser?.getIdToken()) ?? "";
  }, [firebaseUser]);

  const fetchData = useCallback(async () => {
    try {
      const token = await getToken();
      const res   = await fetch("/api/admin/billing", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json  = await res.json() as BillingData;
      setData(json);
      setLastFetched(new Date().toISOString());
    } catch {
      // keep stale data
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => { void fetchData(); }, 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchData]);

  // ── Action helpers ───────────────────────────────────────────────────────────

  async function runAction(key: string, body: Record<string, string>) {
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const token = await getToken();
      await fetch("/api/admin/billing", {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      await fetchData();
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }));
    }
  }

  const s = data?.subscriptions;

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-primary">Admin · Billing</p>
          <h1 className="mt-1 text-3xl font-black flex items-center gap-2">
            <CreditCard className="h-7 w-7 text-primary" />
            Billing Dashboard
          </h1>
          {lastFetched && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Updated {fmtTime(lastFetched)}{autoRefresh && " · auto-refreshes every 60s"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAutoRefresh((v) => !v)}
            className={autoRefresh ? "border-emerald-500/40 text-emerald-400" : ""}>
            {autoRefresh ? <Wifi className="mr-2 h-4 w-4" /> : <WifiOff className="mr-2 h-4 w-4" />}
            {autoRefresh ? "Auto" : "Paused"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { void fetchData(); }} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Revenue Overview ── */}
      {data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <PeriodCard label="Today"      data={data.paymentStats.today}     />
          <PeriodCard label="This Week"  data={data.paymentStats.thisWeek}  />
          <PeriodCard label="This Month" data={data.paymentStats.thisMonth} />
        </div>
      )}

      {/* ── Subscription Breakdown ── */}
      {s && (
        <GlassCard>
          <h2 className="mb-4 font-bold text-sm flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Subscription Breakdown
          </h2>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Total Users"  value={s.total}      />
            <StatCard label="Active Paid"  value={s.activePaid} color="text-emerald-400" />
            <StatCard label="Free"         value={s.free}        />
            <StatCard label="Growth"       value={s.growth}      color="text-emerald-400" />
            <StatCard label="Pro"          value={s.pro}         color="text-primary" />
            <StatCard label="Enterprise"   value={s.enterprise}  color="text-amber-400" />
          </div>
        </GlassCard>
      )}

      {/* ── Webhook Queue Health ── */}
      {data && (
        <GlassCard>
          <h2 className="mb-4 font-bold text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Webhook Queue
          </h2>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Pending"    value={data.webhookQueue.pending}    color={data.webhookQueue.pending > 10 ? "text-amber-400" : ""} />
            <StatCard label="Processing" value={data.webhookQueue.processing} />
            <StatCard label="Done"       value={data.webhookQueue.done}       color="text-emerald-400" />
            <StatCard label="Dead"       value={data.webhookQueue.dead}       color={data.webhookQueue.dead > 0 ? "text-red-400" : ""} />
            <StatCard label="Failed"     value={data.webhookQueue.failed}     color={data.webhookQueue.failed > 0 ? "text-red-400" : ""} />
          </div>

          {/* Dead letters */}
          {data.webhookQueue.deadLetters.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold text-red-400 flex items-center gap-1">
                <XCircle className="h-3 w-3" />
                Dead Letters ({data.webhookQueue.deadLetters.length})
              </p>
              {data.webhookQueue.deadLetters.slice(0, 10).map((dl) => (
                <div key={dl.id}
                  className="flex items-center justify-between rounded-xl bg-red-500/5 border border-red-500/15 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono text-muted-foreground truncate">{dl.id}</p>
                    <p className="text-[10px] text-muted-foreground">{dl.eventType} · {fmtTime(dl.receivedAt)} · {dl.attempts} attempts</p>
                    {dl.lastError && (
                      <p className="text-[10px] text-red-400 truncate">{dl.lastError}</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0 ml-3">
                    <Button size="sm" variant="outline"
                      className="h-7 px-2 text-[10px] border-emerald-500/30 text-emerald-400"
                      disabled={!!actionLoading[`replay_${dl.id}`]}
                      onClick={() => void runAction(`replay_${dl.id}`, { action: "replay_dead_letter", id: dl.id })}>
                      {actionLoading[`replay_${dl.id}`]
                        ? <RefreshCw className="h-3 w-3 animate-spin" />
                        : <RotateCcw className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="outline"
                      className="h-7 px-2 text-[10px]"
                      disabled={!!actionLoading[`resolve_${dl.id}`]}
                      onClick={() => void runAction(`resolve_${dl.id}`, { action: "resolve_dead_letter", id: dl.id })}>
                      {actionLoading[`resolve_${dl.id}`]
                        ? <RefreshCw className="h-3 w-3 animate-spin" />
                        : <CheckCircle className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      )}

      {/* ── Recovery Candidates ── */}
      {data && data.recoveryCandidates.length > 0 && (
        <GlassCard>
          <h2 className="mb-4 font-bold text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            Recovery Candidates ({data.recoveryCandidates.length})
          </h2>
          <div className="space-y-2">
            {data.recoveryCandidates.map((c) => (
              <div key={c.reference}
                className="flex items-center justify-between rounded-xl bg-amber-500/5 border border-amber-500/15 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono text-muted-foreground truncate">{c.reference}</p>
                  <p className="text-[10px] text-muted-foreground">
                    <span className={`mr-2 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${planBadge(c.plan)}`}>
                      {c.plan}
                    </span>
                    {fmtMoney(c.amountGHS)} · {c.ageMinutes}m ago
                  </p>
                </div>
                <Button size="sm" variant="outline"
                  className="h-7 px-2 text-[10px] border-amber-500/30 text-amber-400 shrink-0 ml-3"
                  disabled={!!actionLoading[`recover_${c.reference}`]}
                  onClick={() => void runAction(`recover_${c.reference}`, { action: "recover_payment", reference: c.reference })}>
                  {actionLoading[`recover_${c.reference}`]
                    ? <RefreshCw className="h-3 w-3 animate-spin" />
                    : <><Zap className="h-3 w-3 mr-1" />Recover</>}
                </Button>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* ── Failed Payments ── */}
      {data && data.failedPayments.length > 0 && (
        <GlassCard>
          <h2 className="mb-4 font-bold text-sm flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-400" />
            Recent Failed Payments ({data.failedPayments.length})
          </h2>
          <div className="space-y-2">
            {data.failedPayments.slice(0, 15).map((p) => (
              <div key={p.reference}
                className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono text-muted-foreground truncate">{p.reference}</p>
                  <p className="text-[10px] text-muted-foreground">
                    <span className={`mr-2 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${planBadge(p.plan)}`}>
                      {p.plan}
                    </span>
                    {fmtMoney(p.amountGHS)} · {fmtTime(p.failedAt)}
                  </p>
                  <p className="text-[10px] text-red-400">{p.failureReason}</p>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* ── Recent Activations ── */}
      {data && data.recentActivations.length > 0 && (
        <GlassCard>
          <h2 className="mb-4 font-bold text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            Recent Activations
          </h2>
          <div className="space-y-2">
            {data.recentActivations.slice(0, 10).map((a) => (
              <div key={a.reference}
                className="flex items-center justify-between rounded-xl bg-emerald-500/5 border border-emerald-500/15 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono text-muted-foreground truncate">{a.reference}</p>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${planBadge(a.plan)}`}>
                      {a.plan}
                    </span>
                    {fmtMoney(a.amountGHS)}
                    <Clock className="h-3 w-3" />
                    {fmtTime(a.activatedAt)}
                  </p>
                </div>
                <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0 ml-3" />
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {loading && !data && (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-white/[0.04]" />
          ))}
        </div>
      )}

    </div>
  );
}
