/**
 * lib/workers/notification-worker.ts
 *
 * Smart Notification Worker.
 *
 * Processes notification jobs from the queue with:
 *   - 24-hour deduplication (no duplicate alerts)
 *   - Priority ordering
 *   - Platform-specific WhatsApp/Telegram/app formatting
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationType =
  | "debt_reminder"
  | "low_stock"
  | "daily_summary"
  | "risk_alert"
  | "milestone"
  | "cash_warning";

export type NotificationPlatform = "whatsapp" | "telegram" | "app";
export type NotificationPriority = "high" | "normal" | "low";

export interface NotificationJob {
  userId: string;
  businessId: string;
  type: NotificationType;
  title: string;
  message: string;
  platform: NotificationPlatform;
  priority: NotificationPriority;
  /** Prevents the same notification being sent twice in 24 h, e.g. "debt_reminder_2026-05-19" */
  deduplicationKey: string;
}

// ─── Deduplication ────────────────────────────────────────────────────────────

const DEDUP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Returns true if an identical notification was already sent in the last 24 h.
 * Fails open (returns false) on any Firestore error.
 */
export async function isDuplicate(userId: string, deduplicationKey: string): Promise<boolean> {
  try {
    const db = getAdminDb();
    const docId = `${userId}_${deduplicationKey}`;
    const snap = await db.collection("notification_dedup").doc(docId).get();
    if (!snap.exists) return false;
    const data = snap.data() as { sentAt: string } | undefined;
    if (!data?.sentAt) return false;
    const age = Date.now() - new Date(data.sentAt).getTime();
    return age < DEDUP_TTL_MS;
  } catch {
    return false; // fail-open — never block a notification due to Firestore error
  }
}

async function markAsSent(userId: string, deduplicationKey: string): Promise<void> {
  try {
    const db = getAdminDb();
    const docId = `${userId}_${deduplicationKey}`;
    await db.collection("notification_dedup").doc(docId).set({ sentAt: new Date().toISOString() });
  } catch { /* silent */ }
}

// ─── Platform Formatting ──────────────────────────────────────────────────────

const PLATFORM_ICONS: Record<NotificationType, string> = {
  debt_reminder: "💰",
  low_stock:     "📦",
  daily_summary: "📊",
  risk_alert:    "🚨",
  milestone:     "🏆",
  cash_warning:  "⚠️",
};

/**
 * Formats a notification message for the target platform.
 */
export function formatNotificationForPlatform(job: NotificationJob): string {
  const icon = PLATFORM_ICONS[job.type] ?? "📢";

  switch (job.platform) {
    case "whatsapp":
      return `${icon} *${job.title}*\n\n${job.message}\n\n_Sent by ZURIA_`;

    case "telegram":
      return `${icon} <b>${job.title}</b>\n\n${job.message}\n\n<i>Sent by ZURIA</i>`;

    case "app":
    default:
      return `${job.title}: ${job.message}`;
  }
}

// ─── Main Processor ───────────────────────────────────────────────────────────

/**
 * Process a single notification job.
 * Returns true if the notification was sent, false if deduplicated or failed.
 */
export async function processNotificationJob(job: NotificationJob): Promise<boolean> {
  try {
    // Deduplication check
    const alreadySent = await isDuplicate(job.userId, job.deduplicationKey);
    if (alreadySent) return false;

    const formattedMessage = formatNotificationForPlatform(job);

    // Persist notification to Firestore
    const db = getAdminDb();
    const notifRef = db.collection(collections.notifications).doc();
    await notifRef.set({
      id:          notifRef.id,
      userId:      job.userId,
      businessId:  job.businessId,
      type:        job.type,
      title:       job.title,
      message:     formattedMessage,
      platform:    job.platform,
      priority:    job.priority,
      read:        false,
      createdAt:   new Date().toISOString(),
      syncStatus:  "pending",
    });

    // Mark as sent to prevent duplicates
    await markAsSent(job.userId, job.deduplicationKey);

    return true;
  } catch {
    return false;
  }
}

// ─── Job Factories ────────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Build a debt-reminder notification job.
 */
export function buildDebtReminderJob(
  userId: string,
  businessId: string,
  customerName: string,
  amount: number,
  platform: NotificationPlatform,
): NotificationJob {
  return {
    userId,
    businessId,
    type:             "debt_reminder",
    title:            "Customer owes you money",
    message:          `${customerName} still owes you GH₵${amount.toFixed(2)}. Send them a reminder today.`,
    platform,
    priority:         "normal",
    deduplicationKey: `debt_reminder_${customerName}_${todayKey()}`,
  };
}

/**
 * Build a cash-warning notification job.
 */
export function buildCashWarningJob(
  userId: string,
  businessId: string,
  cashFlowPattern: string,
  platform: NotificationPlatform,
): NotificationJob {
  const messages: Record<string, string> = {
    declining: "Your revenue has been declining this week. Review your top expense categories and consider following up on outstanding debts.",
    volatile:  "Your cash flow is volatile — expenses are high relative to sales. Monitor closely over the next 3 days.",
    default:   "Your cash flow needs attention. Check your sales vs expenses balance.",
  };

  return {
    userId,
    businessId,
    type:             "cash_warning",
    title:            "Cash Flow Alert",
    message:          messages[cashFlowPattern] ?? messages.default,
    platform,
    priority:         "high",
    deduplicationKey: `cash_warning_${cashFlowPattern}_${todayKey()}`,
  };
}

/**
 * Build a risk-alert notification job.
 */
export function buildRiskAlertJob(
  userId: string,
  businessId: string,
  riskLevel: string,
  reason: string,
  platform: NotificationPlatform,
): NotificationJob {
  return {
    userId,
    businessId,
    type:             "risk_alert",
    title:            "Business Risk Alert",
    message:          `Your business risk level is ${riskLevel}. ${reason}`,
    platform,
    priority:         riskLevel === "very_high" ? "high" : "normal",
    deduplicationKey: `risk_alert_${riskLevel}_${todayKey()}`,
  };
}

/**
 * Build a milestone notification job.
 */
export function buildMilestoneJob(
  userId: string,
  businessId: string,
  title: string,
  message: string,
  platform: NotificationPlatform,
): NotificationJob {
  return {
    userId,
    businessId,
    type:             "milestone",
    title,
    message,
    platform,
    priority:         "normal",
    deduplicationKey: `milestone_${title.slice(0, 20)}_${todayKey()}`,
  };
}
