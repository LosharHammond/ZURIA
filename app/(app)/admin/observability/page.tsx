"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Eye, AlertTriangle, XCircle, RefreshCw, Wifi, WifiOff,
  Activity, Zap, Server, Filter,
} from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-provider";

// ─── Types ────────────────────────────────────────────────────────────────────

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
  userId?: string;
  timestamp: string;
}

interface AICostSummary {
  today:     { totalUSD: number; callCount: number };
  thisWeek:  { totalUSD: number; callCount: number };
  thisMonth: { totalUSD: number; callCount: number };
  byModel:   Record<string, { callCount: number; totalUSD: number }>;
}

interface QueueFailureEntry {
  id: string;
  jobType: string;
  error: string;
  failedAt: string;
}

interface WebhookFailureEntry {
  id: string;
  eventType: string;
  attempts: number;
  lastError: string;
  receivedAt: string;
}

interface ObservabilityData {
  generatedAt: string;
  recentErrors: LogEntry[];
  recentWarnings: LogEntry[];
  errorsByModule: Record<string, number>;
  aiCostSummary: AICostSummary;
  queueFailures: QueueFailureEntry[];
  webhookFailures: WebhookFailureEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LEVEL_STYLES: Record<LogLevel, string> = {
  debug: "text-muted-foreground bg-white/[0.03] border-white/[0.06]",
  info:  "text-blue-400 bg-blue-500/5 border-blue-500/20",
  warn:  "text-amber-400 bg-amber-500/5 border-amber-500/20",
  error: "text-red-400 bg-red-500/5 border-red-500/20",
};

const LEVEL_DOT: Record<LogLevel, string> = {
  debug: "bg-white/30",
  info:  "bg-blue-400",
  warn:  "bg-amber-400",
  error: "bg-red-500",
};

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GH", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtUSD(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

// ─── Log Entry Row ────────────────────────────────────────────────────────────

function LogRow({ entry, expanded, onToggle }: {
  entry: LogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const styles = LEVEL_STYLES[entry.level] ?? LEVEL_STYLES.error;

  return (
    <div
      className={`rounded-xl border px-3 py-2 cursor-pointer transition-colors hover:bg-white/[0.02] ${styles}`}
      onClick={onToggle}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full shrink-0 ${LEVEL_DOT[entry.level]}`} />
        <span className="text-[10px] font-mono text-muted-foreground shrink-0 w-16">
          {entry.module}
        </span>
        <span className="text-xs flex-1 truncate">{entry.message}</span>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {fmtTime(entry.timestamp)}
        </span>
      </div>
      {expanded && entry.data && (
        <pre className="mt-2 text-[10px] font-mono text-muted-foreground bg-white/[0.03] rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(entry.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ObservabilityPage() {
  const [obsData,      setObsData]      = useState<ObservabilityData | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [autoRefresh,  setAutoRefresh]  = useState(true);
  const [levelFilter,  setLevelFilter]  = useState<LogLevel | "all">("all");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [expandedIds,  setExpandedIds]  = useState<Set<number>>(new Set());
  const [lastFetched,  setLastFetched]  = useState<string | null>(null);

  const { firebaseUser } = useAuth();

  const getToken = useCallback(async () => {
    return (await firebaseUser?.getIdToken()) ?? "";
  }, [firebaseUser]);

  const fetchData = useCallback(async () => {
    try {
      const token = await getToken();
      const res   = await fetch("/api/admin/observability", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json  = await res.json() as ObservabilityData;
      setObsData(json);
      setLastFetched(new Date().toISOString());
    } catch {
      // keep stale
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => { void fetchData(); }, 30_000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchData]);

  // ── Log filtering ────────────────────────────────────────────────────────────

  const allLogs: LogEntry[] = obsData
    ? [...obsData.recentErrors, ...obsData.recentWarnings].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
    : [];

  const _modules = Array.from(new Set(allLogs.map((l) => l.module))).sort();

  const filteredLogs = allLogs.filter((l) => {
    if (levelFilter  !== "all" && l.level  !== levelFilter)  return false;
    if (moduleFilter !== "all" && l.module !== moduleFilter) return false;
    return true;
  });

  function toggleExpand(idx: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) { next.delete(idx); } else { next.add(idx); }
      return next;
    });
  }

  const ai = obsData?.aiCostSummary;

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-primary">Admin · Observability</p>
          <h1 className="mt-1 text-3xl font-black flex items-center gap-2">
            <Eye className="h-7 w-7 text-primary" />
            Observability Center
          </h1>
          {lastFetched && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Updated {fmtTime(lastFetched)}{autoRefresh && " · refreshes every 30s"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAutoRefresh((v) => !v)}
            className={autoRefresh ? "border-emerald-500/40 text-emerald-400" : ""}>
            {autoRefresh ? <Wifi className="mr-2 h-4 w-4" /> : <WifiOff className="mr-2 h-4 w-4" />}
            {autoRefresh ? "Live" : "Paused"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { void fetchData(); }} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Error Module Heatmap ── */}
      {obsData && Object.keys(obsData.errorsByModule).length > 0 && (
        <GlassCard>
          <h2 className="mb-4 font-bold text-sm flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-400" />
            Errors by Module
          </h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(obsData.errorsByModule)
              .sort(([, a], [, b]) => b - a)
              .map(([mod, count]) => (
                <button
                  key={mod}
                  onClick={() => setModuleFilter(moduleFilter === mod ? "all" : mod)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    moduleFilter === mod
                      ? "bg-red-500/20 text-red-400 border border-red-500/30"
                      : "bg-white/[0.04] text-muted-foreground border border-white/[0.08] hover:bg-white/[0.08]"
                  }`}
                >
                  {mod} <span className="font-black">{count}</span>
                </button>
              ))}
          </div>
        </GlassCard>
      )}

      {/* ── AI Cost Summary ── */}
      {ai && (
        <GlassCard>
          <h2 className="mb-4 font-bold text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            AI Cost Overview
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {(["today", "thisWeek", "thisMonth"] as const).map((period) => {
              const d = ai[period];
              const label = period === "today" ? "Today" : period === "thisWeek" ? "This Week" : "This Month";
              return (
                <div key={period} className="rounded-xl bg-white/[0.03] p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-lg font-black">{fmtUSD(d.totalUSD)}</p>
                  <p className="text-[10px] text-muted-foreground">{d.callCount} calls</p>
                </div>
              );
            })}
          </div>
          {Object.keys(ai.byModel).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(ai.byModel).map(([model, stats]) => (
                <div key={model}
                  className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2 text-xs">
                  <span className="font-mono text-muted-foreground">{model}</span>
                  <span className="ml-2 font-bold">{fmtUSD(stats.totalUSD)}</span>
                  <span className="ml-1 text-[10px] text-muted-foreground">({stats.callCount})</span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      )}

      {/* ── Queue + Webhook Failures ── */}
      {obsData && (obsData.queueFailures.length > 0 || obsData.webhookFailures.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {obsData.queueFailures.length > 0 && (
            <GlassCard>
              <h2 className="mb-3 font-bold text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-red-400" />
                Queue Failures ({obsData.queueFailures.length})
              </h2>
              <div className="space-y-2">
                {obsData.queueFailures.map((qf) => (
                  <div key={qf.id}
                    className="rounded-xl bg-red-500/5 border border-red-500/15 px-3 py-2">
                    <p className="text-xs font-semibold">{qf.jobType}</p>
                    <p className="text-[10px] text-red-400 truncate">{qf.error}</p>
                    <p className="text-[10px] text-muted-foreground">{fmtTime(qf.failedAt)}</p>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
          {obsData.webhookFailures.length > 0 && (
            <GlassCard>
              <h2 className="mb-3 font-bold text-sm flex items-center gap-2">
                <Server className="h-4 w-4 text-red-400" />
                Webhook Failures ({obsData.webhookFailures.length})
              </h2>
              <div className="space-y-2">
                {obsData.webhookFailures.map((wf) => (
                  <div key={wf.id}
                    className="rounded-xl bg-red-500/5 border border-red-500/15 px-3 py-2">
                    <p className="text-xs font-semibold">{wf.eventType}</p>
                    <p className="text-[10px] text-red-400 truncate">{wf.lastError}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {wf.attempts} attempts · {fmtTime(wf.receivedAt)}
                    </p>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </div>
      )}

      {/* ── Log Explorer ── */}
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            Log Explorer ({filteredLogs.length})
          </h2>
          <div className="flex items-center gap-2">
            <Filter className="h-3 w-3 text-muted-foreground" />
            {(["all", "error", "warn"] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setLevelFilter(lvl)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                  levelFilter === lvl
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "bg-white/[0.04] text-muted-foreground border border-white/[0.08] hover:bg-white/[0.08]"
                }`}
              >
                {lvl}
              </button>
            ))}
            {moduleFilter !== "all" && (
              <button
                onClick={() => setModuleFilter("all")}
                className="rounded-full px-2 py-1 text-[10px] bg-white/[0.04] text-muted-foreground border border-white/[0.08] hover:bg-white/[0.08]"
              >
                ✕ {moduleFilter}
              </button>
            )}
          </div>
        </div>

        {loading && !obsData ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-white/[0.04]" />
            ))}
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-12 text-center">
            <Eye className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="text-sm text-muted-foreground">No logs match the current filter</p>
          </div>
        ) : (
          <div className="space-y-1 max-h-[600px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 pr-1">
            {filteredLogs.map((entry, idx) => (
              <LogRow
                key={idx}
                entry={entry}
                expanded={expandedIds.has(idx)}
                onToggle={() => toggleExpand(idx)}
              />
            ))}
          </div>
        )}
      </GlassCard>

    </div>
  );
}
