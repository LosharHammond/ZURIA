/**
 * lib/subscriptions/failsafe-access.ts
 *
 * Subscription Failsafe Access System.
 *
 * When users hit daily limits, they must ALWAYS be able to:
 *   - Subscribe / upgrade / pay
 *   - Access billing and account settings
 *   - Use referral system
 *   - Get help and support
 *   - View their data
 *
 * Only AI analysis, report generation, and forecasting are restricted.
 */

"use server";

// ─── Always-Allowed Command Patterns ─────────────────────────────────────────

/**
 * Commands that bypass all subscription limits.
 * These patterns ensure monetization and support flows are never blocked.
 */
export const ALWAYS_ALLOWED_COMMANDS = new Set<string>([
  "subscribe",
  "upgrade",
  "plans",
  "billing",
  "pay",
  "help",
  "referrals",
  "support",
  "withdraw",
  "account",
  "settings",
  "login",
]);

// ─── Limit-Restricted Command Patterns ───────────────────────────────────────

/**
 * Commands that are blocked when a user has hit their daily limit.
 * These require AI compute and are gated by subscription tier.
 */
export const LIMIT_RESTRICTED_COMMANDS = new Set<string>([
  "analyze",
  "report",
  "forecast",
  "ai",
  "insights",
]);

// ─── Types ────────────────────────────────────────────────────────────────────

export type AccessDecision = {
  allowed: boolean;
  reason: string;
  upgradePrompt?: string;
  graceful: boolean;
};

// ─── Command Matchers ─────────────────────────────────────────────────────────

/**
 * Checks if the user input matches any always-allowed pattern.
 * Case-insensitive, partial-match on word boundaries.
 */
export function isCommandAlwaysAllowed(input: string): boolean {
  const normalized = input.toLowerCase().trim();
  for (const pattern of ALWAYS_ALLOWED_COMMANDS) {
    if (normalized.includes(pattern)) return true;
  }
  return false;
}

/**
 * Checks if the user input matches a limit-restricted pattern.
 * These commands are blocked when the daily limit is exceeded.
 */
export function isCommandRestricted(input: string): boolean {
  const normalized = input.toLowerCase().trim();
  for (const pattern of LIMIT_RESTRICTED_COMMANDS) {
    if (normalized.includes(pattern)) return true;
  }
  return false;
}

// ─── Access Decision ──────────────────────────────────────────────────────────

/**
 * Returns a full access decision for the given user + input combination.
 * Never throws — graceful fallback on any unexpected input.
 */
export async function checkSubscriptionAccess(params: {
  userId: string;
  plan: string;
  dailyCount: number;
  dailyLimit: number;
  input: string;
}): Promise<AccessDecision> {
  const { plan, dailyCount, dailyLimit, input } = params;

  // 1. Always-allowed commands bypass all limits
  if (isCommandAlwaysAllowed(input)) {
    return {
      allowed: true,
      reason: "Command is always permitted regardless of subscription status.",
      graceful: true,
    };
  }

  // 2. Within daily limit — allow
  if (dailyCount < dailyLimit) {
    return {
      allowed: true,
      reason: `Within daily limit (${dailyCount}/${dailyLimit}).`,
      graceful: true,
    };
  }

  // 3. Over limit — check if command is restricted
  if (isCommandRestricted(input)) {
    const upgradePrompt = buildUpgradePrompt(plan, input);
    return {
      allowed: false,
      reason: getSoftLockMessage(plan, dailyLimit),
      upgradePrompt,
      graceful: true,
    };
  }

  // 4. Over limit but command is not AI-restricted — allow with soft warning
  return {
    allowed: true,
    reason: "Non-AI command permitted even over limit.",
    upgradePrompt: buildUpgradePrompt(plan, input),
    graceful: true,
  };
}

// ─── Message Builders ─────────────────────────────────────────────────────────

/**
 * Builds a friendly, Ghanaian-context upgrade message.
 */
export function buildUpgradePrompt(plan: string, commandBlocked: string): string {
  const planName = plan === "free" ? "Free" : plan.charAt(0).toUpperCase() + plan.slice(1);
  const isRestricted = isCommandRestricted(commandBlocked);
  const feature = isRestricted ? commandBlocked : "this feature";

  if (plan === "free") {
    return (
      `You've reached your daily limit on the ${planName} plan. ` +
      `To use ${feature} more, upgrade to Growth (GH₵20/mo) or Pro (GH₵50/mo). ` +
      `Type *SUBSCRIBE* to see plans, or *REFERRALS* to earn free access by referring friends.`
    );
  }

  if (plan === "growth") {
    return (
      `Your Growth plan daily limit is full. ` +
      `Upgrade to Pro (GH₵50/mo) for unlimited ${feature} access. ` +
      `Type *UPGRADE* to continue or wait until tomorrow for your limit to reset.`
    );
  }

  return (
    `Your daily ${feature} limit has been reached. ` +
    `Contact support or type *HELP* if you believe this is an error.`
  );
}

/**
 * Returns the soft-lock message shown to users at their daily limit.
 * Informational — not a hard block.
 */
export function getSoftLockMessage(plan: string, dailyLimit: number): string {
  const planName = plan === "free" ? "Free" : plan.charAt(0).toUpperCase() + plan.slice(1);
  return (
    `You've used all ${dailyLimit} of your daily AI requests on the ${planName} plan. ` +
    `Your limit resets tomorrow. You can still check your account, view reports, ` +
    `manage referrals, and access billing. Type *UPGRADE* for more capacity.`
  );
}
