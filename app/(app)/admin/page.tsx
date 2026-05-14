"use client";

import { useEffect, useState } from "react";
import { Users, Store, ReceiptText, RefreshCw, Smartphone, Globe, ArrowDownToLine, Check, X, AlertTriangle, Info } from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/stores/app-store";
import { useAuth } from "@/providers/auth-provider";
import { formatMoney } from "@/lib/utils";
import { TRANSACTION_TYPE_LABELS, type WithdrawalRequest } from "@/types/domain";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminUser {
  id: string;
  ownerName: string;
  phoneNumber: string;
  onboardingComplete: boolean;
  businessId: string | null;
  preferredLanguage: string;
  createdAt: string | null;
}

interface AdminTxn {
  id: string;
  businessId: string;
  type: string;
  amount: number;
  rawText: string;
  source: string;
  createdAt: string | null;
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
  totals: { users: number; businesses: number; transactions: number };
  users: AdminUser[];
  transactions: AdminTxn[];
  withdrawals: WithdrawalRequest[];
  errors: AdminErrorLog[];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user } = useAppStore();
  const { firebaseUser } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Track which withdrawal is currently being processed to prevent double-clicks
  const [processingId, setProcessingId] = useState<string | null>(null);

  const adminPhone = process.env.NEXT_PUBLIC_ADMIN_PHONE ?? "";
  const myPhone = firebaseUser?.phoneNumber ?? user?.phoneNumber ?? "";
  const isAdmin = adminPhone && myPhone === adminPhone;

  async function getToken() {
    return firebaseUser?.getIdToken() ?? "";
  }

  async function processWithdrawal(id: string, action: "approve" | "reject") {
    if (processingId) return; // Already processing another
    setProcessingId(id);
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/withdrawals/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Failed to ${action} withdrawal`);
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} withdrawal`);
    } finally {
      setProcessingId(null);
    }
  }

  async function load() {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/admin/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load admin data.");
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [isAdmin]);

  if (!user) return null;

  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <p className="text-2xl font-black">Access denied</p>
          <p className="mt-2 text-sm text-muted-foreground">This page is for administrators only.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-primary">System overview</p>
          <h1 className="mt-1 text-3xl font-black">Admin Panel</h1>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <GlassCard>
          <p className="text-sm text-destructive">{error}</p>
        </GlassCard>
      )}

      {/* Totals */}
      {stats && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard icon={Users} label="Total users" value={stats.totals.users} />
            <StatCard icon={Store} label="Businesses" value={stats.totals.businesses} />
            <StatCard icon={ReceiptText} label="Transactions" value={stats.totals.transactions} />
          </div>

          {/* Recent users */}
          <GlassCard>
            <h2 className="mb-4 font-bold">Recent registrations</h2>
            <div className="space-y-3">
              {stats.users.length === 0 && <p className="text-sm text-muted-foreground">No users yet.</p>}
              {stats.users.map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2">
                  <div>
                    <p className="text-sm font-semibold">{u.ownerName}</p>
                    <p className="text-xs text-muted-foreground">{u.phoneNumber}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Globe className="h-3 w-3" />{u.preferredLanguage}
                    </span>
                    <Badge variant={u.onboardingComplete ? "success" : "warning"}>
                      {u.onboardingComplete ? "Active" : "Incomplete"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* Pending withdrawals */}
          <GlassCard>
            <div className="flex items-center gap-2 mb-4">
              <ArrowDownToLine className="h-4 w-4 text-primary" />
              <h2 className="font-bold">Pending withdrawals</h2>
              {stats.withdrawals.length > 0 && (
                <span className="ml-auto rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-400">
                  {stats.withdrawals.length}
                </span>
              )}
            </div>
            <div className="space-y-3">
              {stats.withdrawals.length === 0 && (
                <p className="text-sm text-muted-foreground">No pending requests.</p>
              )}
              {stats.withdrawals.map((w) => (
                <div key={w.id} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-3">
                  <div>
                    <p className="text-sm font-semibold">{formatMoney(w.amount)}</p>
                    <p className="text-xs text-muted-foreground">{w.ownerName} · {w.phoneNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {w.method === "momo" ? `${w.network ?? "MoMo"}` : "Bank"} · {w.accountNumber} · {w.accountName}
                    </p>
                  </div>
                  <div className="flex gap-2 ml-3">
                    <Button
                      size="sm"
                      onClick={() => processWithdrawal(w.id, "approve")}
                      disabled={!!processingId}
                      className="gap-1 bg-green-500/20 text-green-400 hover:bg-green-500/30"
                    >
                      {processingId === w.id
                        ? <RefreshCw className="h-3 w-3 animate-spin" />
                        : <Check className="h-3 w-3" />}
                      Pay
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => processWithdrawal(w.id, "reject")}
                      disabled={!!processingId}
                      className="gap-1"
                    >
                      <X className="h-3 w-3" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* Recent transactions */}
          <GlassCard>
            <h2 className="mb-4 font-bold">Recent transactions (all businesses)</h2>
            <div className="space-y-2">
              {stats.transactions.length === 0 && <p className="text-sm text-muted-foreground">No transactions yet.</p>}
              {stats.transactions.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {(TRANSACTION_TYPE_LABELS as Record<string, string>)[t.type] ?? t.type}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{t.rawText || t.businessId}</p>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-2">
                    {t.source === "whatsapp" && (
                      <span className="flex items-center gap-1 text-xs text-green-400">
                        <Smartphone className="h-3 w-3" /> WA
                      </span>
                    )}
                    <span className="text-sm font-bold">{formatMoney(t.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* Error log */}
          <GlassCard>
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <h2 className="font-bold">Error log</h2>
              {stats.errors.length > 0 && (
                <span className="ml-auto rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-bold text-destructive">
                  {stats.errors.length}
                </span>
              )}
            </div>
            {stats.errors.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-primary">
                <Info className="h-4 w-4" />
                <p>No errors logged. Everything looks good! ✅</p>
              </div>
            ) : (
              <div className="space-y-2">
                {stats.errors.map((e) => (
                  <div key={e.id} className={`rounded-xl px-3 py-2.5 ${e.severity === "error" ? "bg-destructive/[0.08] border border-destructive/20" : "bg-amber-500/[0.07] border border-amber-500/20"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs font-bold ${e.severity === "error" ? "text-destructive" : "text-amber-400"}`}>
                          {e.context}
                        </p>
                        <p className="mt-0.5 text-sm break-all">{e.message}</p>
                        {e.phone && <p className="mt-0.5 text-xs text-muted-foreground">Phone: {e.phone}</p>}
                      </div>
                      <p className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
                        {e.createdAt ? new Date(e.createdAt).toLocaleString("en-GH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </>
      )}

      {loading && !stats && (
        <GlassCard>
          <div className="flex items-center gap-3 text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <p className="text-sm">Loading admin data…</p>
          </div>
        </GlassCard>
      )}
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <GlassCard>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-2xl font-black">{value.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </div>
    </GlassCard>
  );
}
