"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Activity, Wifi, WifiOff, AlertTriangle, CheckCircle,
  Clock, RefreshCw, Zap, Server, Database, MessageSquare,
} from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-provider";

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceStatus = "operational" | "degraded" | "offline" | "unknown";

interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  latencyMs: number | null;
  lastCheckedAt: string;
  lastSuccessAt: string | null;
  failureReason: string | null;
  uptime: number;
  details: Record<string, unknown>;
}

interface SystemHealthReport {
  overallStatus: ServiceStatus;
  services: ServiceHealth[];
  queueDepth: number;
  parserHealth: { avgConfidence: number; failureRate: number };
  aiHealth: { groqAvailable: boolean; lastModel: string | null; avgLatencyMs: number };
  generatedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_DOT: Record<ServiceStatus, string> = {
  operational: "bg-emerald-400",
  degraded:    "bg-amber-400",
  offline:     "bg-red-500",
  unknown:     "bg-white/30",
};

const STATUS_TEXT: Record<ServiceStatus, string> = {
  operational: "text-emerald-400",
  degraded:    "text-amber-400",
  offline:     "text-red-400",
  unknown:     "text-muted-foreground",
};

const STATUS_BG: Record<ServiceStatus, string> = {
  operational: "bg-emerald-500/10 border-emerald-500/20",
  degraded:    "bg-amber-500/10 border-amber-500/20",
  offline:     "bg-red-500/10 border-red-500/20",
  unknown:     "bg-white/[0.03] border-white/[0.06]",
};

const SERVICE_ICONS: Record<string, React.ElementType> = {
  firebase:      Database,
  groq_fast:     Zap,
  groq_advanced: Zap,
  telegram:      MessageSquare,
  twilio:        MessageSquare,
  paystack:      Server,
  queue:         Activity,
  parser:        Activity,
  memory:        Server,
};

const SERVICE_LABELS: Record<string, string> = {
  firebase:      "Firebase",
  groq_fast:     "Groq Fast",
  groq_advanced: "Groq Advanced",
  telegram:      "Telegram",
  twilio:        "Twilio",
  paystack:      "Paystack",
  queue:         "Job Queue",
  parser:        "Parser",
  memory:        "Memory",
};

function fmtLatency(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000)   return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ─── Service Card ─────────────────────────────────────────────────────────────

function ServiceCard({ service }: { service: ServiceHealth }) {
  const Icon  = SERVICE_ICONS[service.name] ?? Server;
  const label = SERVICE_LABELS[service.name] ?? service.name;

  return (
    <div className={`rounded-2xl border p-4 space-y-3 ${STATUS_BG[service.status]}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${STATUS_TEXT[service.status]}`} />
          <span className="text-sm font-bold">{label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[service.status]}`} />
          <span className={`text-xs font-semibold capitalize ${STATUS_TEXT[service.status]}`}>
            {service.status}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {fmtLatency(service.latencyMs)}
        </span>
        <span>{service.uptime}% uptime</span>
      </div>

      {service.failureReason && (
        <p className="text-xs text-red-400 break-words">{service.failureReason}</p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const SERVICE_ORDER = [
  "firebase",
  "groq_fast",
  "groq_advanced",
  "telegram",
  "twilio",
  "paystack",
  "queue",
  "parser",
  "memory",
];

export default function AIMonitoringPage() {
  const [report,        setReport]        = useState<SystemHealthReport | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [autoRefresh,   setAutoRefresh]   = useState(true);
  const [lastFetched,   setLastFetched]   = useState<string | null>(null);

  const { firebaseUser } = useAuth();

  const getToken = useCallback(async () => {
    return (await firebaseUser?.getIdToken()) ?? "";
  }, [firebaseUser]);

  const fetchHealth = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch("/api/admin/system-status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as SystemHealthReport;
      setReport(data);
      setLastFetched(new Date().toISOString());
    } catch {
      // silent — keep showing stale data
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  // Initial load
  useEffect(() => {
    void fetchHealth();
  }, [fetchHealth]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => { void fetchHealth(); }, 30_000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchHealth]);

  // Sort services by known order
  const orderedServices = report
    ? SERVICE_ORDER.map((name) => report.services.find((s) => s.name === name)).filter(Boolean) as ServiceHealth[]
    : [];

  const overall = report?.overallStatus ?? "unknown";

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-primary">Infrastructure</p>
          <h1 className="mt-1 text-3xl font-black flex items-center gap-2">
            <Activity className="h-7 w-7 text-primary" />
            AI System Monitor
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh((v) => !v)}
            className={autoRefresh ? "border-emerald-500/40 text-emerald-400" : ""}
          >
            {autoRefresh ? <Wifi className="mr-2 h-4 w-4" /> : <WifiOff className="mr-2 h-4 w-4" />}
            {autoRefresh ? "Auto" : "Paused"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void fetchHealth(); }}
            disabled={loading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Overall Status Banner ── */}
      <GlassCard>
        <div className="flex items-center gap-4">
          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${STATUS_BG[overall]}`}>
            {overall === "operational"
              ? <CheckCircle className="h-7 w-7 text-emerald-400" />
              : overall === "degraded"
              ? <AlertTriangle className="h-7 w-7 text-amber-400" />
              : <WifiOff className="h-7 w-7 text-muted-foreground" />}
          </div>
          <div className="flex-1">
            <p className={`text-2xl font-black capitalize ${STATUS_TEXT[overall]}`}>
              {overall === "operational" ? "All Systems Operational" :
               overall === "degraded"   ? "Degraded — Issues Detected" :
               overall === "offline"    ? "System Offline" : "Status Unknown"}
            </p>
            {lastFetched && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Last checked: {fmtTime(lastFetched)}
                {autoRefresh && " · Auto-refreshing every 30s"}
              </p>
            )}
          </div>
          {report && (
            <div className="flex gap-4 text-center shrink-0">
              <div>
                <p className="text-xl font-black">{report.queueDepth}</p>
                <p className="text-xs text-muted-foreground">Queue depth</p>
              </div>
            </div>
          )}
        </div>
      </GlassCard>

      {/* ── Service Grid ── */}
      {loading && !report ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_ORDER.map((name) => (
            <div key={name} className="h-28 animate-pulse rounded-2xl bg-white/[0.04]" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orderedServices.map((service) => (
            <ServiceCard key={service.name} service={service} />
          ))}
        </div>
      )}

      {/* ── AI Health ── */}
      {report && (
        <GlassCard>
          <h2 className="mb-4 font-bold text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            AI Health
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl bg-white/[0.03] p-3 space-y-1">
              <p className="text-xs text-muted-foreground">Groq Available</p>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${report.aiHealth.groqAvailable ? "bg-emerald-400" : "bg-red-500"}`} />
                <p className={`text-sm font-bold ${report.aiHealth.groqAvailable ? "text-emerald-400" : "text-red-400"}`}>
                  {report.aiHealth.groqAvailable ? "Online" : "Offline"}
                </p>
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-3 space-y-1">
              <p className="text-xs text-muted-foreground">Avg Latency</p>
              <p className="text-sm font-bold">{fmtLatency(report.aiHealth.avgLatencyMs)}</p>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-3 space-y-1">
              <p className="text-xs text-muted-foreground">Last Model</p>
              <p className="text-sm font-bold font-mono truncate">
                {report.aiHealth.lastModel ?? "—"}
              </p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* ── Parser Health ── */}
      {report && (
        <GlassCard>
          <h2 className="mb-4 font-bold text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Parser Health
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-white/[0.03] p-3 space-y-1">
              <p className="text-xs text-muted-foreground">Avg Confidence</p>
              <p className={`text-lg font-black ${
                report.parserHealth.avgConfidence >= 0.9 ? "text-emerald-400" :
                report.parserHealth.avgConfidence >= 0.6 ? "text-amber-400" : "text-red-400"
              }`}>
                {Math.round(report.parserHealth.avgConfidence * 100)}%
              </p>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-3 space-y-1">
              <p className="text-xs text-muted-foreground">Failure Rate</p>
              <p className={`text-lg font-black ${
                report.parserHealth.failureRate < 0.1 ? "text-emerald-400" :
                report.parserHealth.failureRate < 0.3 ? "text-amber-400" : "text-red-400"
              }`}>
                {Math.round(report.parserHealth.failureRate * 100)}%
              </p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* ── Timestamp ── */}
      {report && (
        <p className="text-xs text-center text-muted-foreground">
          Report generated at {fmtTime(report.generatedAt)}
        </p>
      )}

    </div>
  );
}
