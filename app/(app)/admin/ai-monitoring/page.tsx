"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Activity, Wifi, WifiOff, AlertTriangle, CheckCircle,
  Clock, RefreshCw, Zap, Server, Database, MessageSquare,
  Key, ShieldCheck, ShieldX, CreditCard, Bot,
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

interface ApiKeyStatus {
  key: string;
  label: string;
  configured: boolean;
  masked?: string;
}

interface SystemHealthReport {
  overallStatus: ServiceStatus;
  services: ServiceHealth[];
  apiKeys: ApiKeyStatus[];
  queueDepth: number;
  parserHealth: { avgConfidence: number; failureRate: number };
  aiHealth: { groqAvailable: boolean; openaiAvailable: boolean; lastModel: string | null; avgLatencyMs: number };
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
  firebase:  Database,
  groq_fast: Zap,
  openai:    Zap,
  telegram:  Bot,
  twilio:    MessageSquare,
  paystack:  CreditCard,
  queue:     Activity,
  parser:    Activity,
};

const SERVICE_LABELS: Record<string, string> = {
  firebase:  "Firebase / Firestore",
  groq_fast: "Groq (llama-3.1-8b)",
  openai:    "OpenAI (GPT-4o-mini)",
  telegram:  "Telegram Bot",
  twilio:    "Twilio / WhatsApp",
  paystack:  "Paystack Payments",
  queue:     "Job Queue",
  parser:    "Intent Parser",
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

  const isUnconfigured = service.details.configured === false;
  const statusLabel = isUnconfigured ? "Not configured" : service.status;

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
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {fmtLatency(service.latencyMs)}
        </span>
        {!isUnconfigured && <span>{service.uptime}% uptime</span>}
      </div>

      {/* Extra details */}
      {service.name === "telegram" && typeof service.details.username === "string" && (
        <p className="text-xs text-muted-foreground">
          @{service.details.username} · {typeof service.details.botName === "string" ? service.details.botName : ""}
        </p>
      )}
      {service.name === "twilio" && typeof service.details.whatsappNumber === "string" && (
        <p className="text-xs text-muted-foreground">
          {service.details.whatsappNumber}
        </p>
      )}
      {service.name === "parser" && typeof service.details.avgConfidence === "number" && typeof service.details.failureRate === "number" && (
        <p className="text-xs text-muted-foreground">
          Avg confidence: {service.details.avgConfidence}% · Failure: {service.details.failureRate}%
        </p>
      )}
      {service.name === "queue" && typeof service.details.pendingJobs === "number" && (
        <p className="text-xs text-muted-foreground">
          {service.details.pendingJobs} pending jobs
        </p>
      )}

      {service.failureReason && !isUnconfigured && (
        <p className="text-xs text-red-400 break-words">{service.failureReason}</p>
      )}
      {isUnconfigured && (
        <p className="text-xs text-muted-foreground break-words">{service.failureReason}</p>
      )}
    </div>
  );
}

// ─── API Key Badge ────────────────────────────────────────────────────────────

function ApiKeyBadge({ keyStatus }: { keyStatus: ApiKeyStatus }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/[0.06] last:border-0">
      <div className="flex items-center gap-2.5">
        {keyStatus.configured
          ? <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          : <ShieldX className="h-4 w-4 text-red-400 shrink-0" />}
        <div>
          <p className="text-sm font-medium">{keyStatus.label}</p>
          <p className="text-xs text-muted-foreground font-mono">{keyStatus.key}</p>
        </div>
      </div>
      <div className="text-right shrink-0 ml-3">
        {keyStatus.configured ? (
          <div className="space-y-0.5">
            <span className="text-xs font-bold text-emerald-400">Configured</span>
            {keyStatus.masked && (
              <p className="text-xs text-muted-foreground font-mono">{keyStatus.masked}</p>
            )}
          </div>
        ) : (
          <span className="text-xs font-bold text-red-400">Missing</span>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const SERVICE_ORDER = [
  "firebase",
  "paystack",
  "groq_fast",
  "openai",
  "telegram",
  "twilio",
  "queue",
  "parser",
];

export default function AIMonitoringPage() {
  const [report,      setReport]      = useState<SystemHealthReport | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastFetched, setLastFetched] = useState<string | null>(null);

  const { firebaseUser } = useAuth();

  const getToken = useCallback(async () => {
    return (await firebaseUser?.getIdToken()) ?? "";
  }, [firebaseUser]);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
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

  // Auto-refresh every 60 seconds (health checks hit external APIs — be polite)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => { void fetchHealth(); }, 60_000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchHealth]);

  // Sort services by known order
  const orderedServices = report
    ? SERVICE_ORDER.map((name) => report.services.find((s) => s.name === name)).filter(Boolean) as ServiceHealth[]
    : [];

  const overall = report?.overallStatus ?? "unknown";

  // Key stats
  const configuredKeyCount  = report?.apiKeys.filter((k) => k.configured).length ?? 0;
  const totalKeyCount       = report?.apiKeys.length ?? 0;
  const operationalServices = orderedServices.filter((s) => s.status === "operational").length;
  const checkedServices     = orderedServices.filter((s) => s.status !== "unknown").length;

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-primary">Infrastructure</p>
          <h1 className="mt-1 text-3xl font-black flex items-center gap-2">
            <Activity className="h-7 w-7 text-primary" />
            System Monitor
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
               overall === "offline"    ? "System Offline" : "Checking…"}
            </p>
            {lastFetched && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Last checked: {fmtTime(lastFetched)}
                {autoRefresh && " · Auto-refreshing every 60s"}
              </p>
            )}
          </div>
          {report && (
            <div className="flex gap-6 text-center shrink-0">
              <div>
                <p className="text-xl font-black">
                  {operationalServices}/{checkedServices}
                </p>
                <p className="text-xs text-muted-foreground">Services up</p>
              </div>
              <div>
                <p className={`text-xl font-black ${configuredKeyCount === totalKeyCount ? "text-emerald-400" : "text-amber-400"}`}>
                  {configuredKeyCount}/{totalKeyCount}
                </p>
                <p className="text-xs text-muted-foreground">Keys set</p>
              </div>
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

      {/* ── API Key Configuration ── */}
      {report && report.apiKeys.length > 0 && (
        <GlassCard>
          <h2 className="mb-4 font-bold text-sm flex items-center gap-2">
            <Key className="h-4 w-4 text-primary" />
            API Keys & Environment
            <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${
              configuredKeyCount === totalKeyCount
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-amber-500/15 text-amber-400"
            }`}>
              {configuredKeyCount}/{totalKeyCount} configured
            </span>
          </h2>
          <div className="space-y-0">
            {report.apiKeys.map((keyStatus) => (
              <ApiKeyBadge key={keyStatus.key} keyStatus={keyStatus} />
            ))}
          </div>
        </GlassCard>
      )}

      {/* ── AI Health ── */}
      {report && (
        <GlassCard>
          <h2 className="mb-4 font-bold text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            AI Provider Health
          </h2>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-xl bg-white/[0.03] p-3 space-y-1">
              <p className="text-xs text-muted-foreground">Groq</p>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${report.aiHealth.groqAvailable ? "bg-emerald-400" : "bg-white/20"}`} />
                <p className={`text-sm font-bold ${report.aiHealth.groqAvailable ? "text-emerald-400" : "text-muted-foreground"}`}>
                  {report.aiHealth.groqAvailable ? "Online" : "Not set"}
                </p>
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-3 space-y-1">
              <p className="text-xs text-muted-foreground">OpenAI</p>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${report.aiHealth.openaiAvailable ? "bg-emerald-400" : "bg-white/20"}`} />
                <p className={`text-sm font-bold ${report.aiHealth.openaiAvailable ? "text-emerald-400" : "text-muted-foreground"}`}>
                  {report.aiHealth.openaiAvailable ? "Online" : "Not set"}
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
            Parser Health <span className="text-muted-foreground font-normal text-xs">(last 100 entries)</span>
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
          Report generated at {fmtTime(report.generatedAt)} · Live pings to Paystack, Telegram, OpenAI, Twilio
        </p>
      )}

    </div>
  );
}
