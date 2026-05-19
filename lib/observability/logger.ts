/**
 * ZURIA Observability Logger
 *
 * Structured logging with context, severity, and optional Firestore persistence.
 * Error-level logs are persisted to Firestore for post-mortem analysis.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
  userId?: string;
  timestamp: string;
}

// ─── Firestore persistence (fire-and-forget, errors only) ────────────────────

async function persistErrorLog(entry: LogEntry): Promise<void> {
  try {
    const db = getAdminDb();
    const id = crypto.randomUUID();
    await db.collection(collections.errors).doc(id).set(entry);
  } catch {
    // Intentionally swallowed — logger must never throw
  }
}

// ─── Logger Class ─────────────────────────────────────────────────────────────

const EMOJI: Record<LogLevel, string> = {
  debug: "🔍",
  info:  "ℹ️",
  warn:  "⚠️",
  error: "❌",
};

export class ZuriaLogger {
  private readonly module: string;

  constructor(module: string) {
    this.module = module;
  }

  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    userId?: string,
  ): void {
    // Skip debug logs in production
    if (level === "debug" && process.env.NODE_ENV === "production") return;

    const entry: LogEntry = {
      level,
      module: this.module,
      message,
      ...(data !== undefined ? { data } : {}),
      ...(userId !== undefined ? { userId } : {}),
      timestamp: new Date().toISOString(),
    };

    const prefix = EMOJI[level];
    const consoleArgs: [string, ...unknown[]] = [
      `${prefix} [${this.module}] ${message}`,
      ...(data !== undefined ? [data] : [""]),
    ];

    if (level === "debug" || level === "info") {
      console.log(...consoleArgs);
    } else if (level === "warn") {
      console.warn(...consoleArgs);
    } else {
      console.error(...consoleArgs);
    }

    // Persist errors to Firestore asynchronously
    if (level === "error") {
      persistErrorLog(entry).catch(() => {});
    }
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.log("debug", msg, data);
  }

  info(msg: string, data?: Record<string, unknown>, userId?: string): void {
    this.log("info", msg, data, userId);
  }

  warn(msg: string, data?: Record<string, unknown>, userId?: string): void {
    this.log("warn", msg, data, userId);
  }

  error(msg: string, data?: Record<string, unknown>, userId?: string): void {
    this.log("error", msg, data, userId);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createLogger(module: string): ZuriaLogger {
  return new ZuriaLogger(module);
}

// ─── Pre-built Module Loggers ─────────────────────────────────────────────────

export const log = {
  groq:     createLogger("groq"),
  parser:   createLogger("parser"),
  memory:   createLogger("memory"),
  webhook:  createLogger("webhook"),
  learning: createLogger("learning"),
  reports:  createLogger("reports"),
  security: createLogger("security"),
  queue:    createLogger("queue"),
} as const;
