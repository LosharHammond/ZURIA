/**
 * lib/emotional-intelligence/index.ts
 *
 * Emotional Intelligence System.
 *
 * African SMEs are emotional operators. Business stress, burnout, and panic
 * are common. ZURIA detects emotional signals and responds with operational
 * reassurance — not generic empathy, but business-grounded comfort.
 *
 * "Sales slowed this week, but your debt exposure remains manageable."
 * NOT: "I understand you're feeling stressed."
 *
 * Server-only.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmotionalState =
  | "stressed"
  | "panicked"
  | "frustrated"
  | "burnt_out"
  | "uncertain"
  | "optimistic"
  | "confident"
  | "neutral";

export interface EmotionalSignal {
  state: EmotionalState;
  intensity: "high" | "medium" | "low";
  triggers: string[];          // what phrases triggered this
  operationalContext: string | null; // business-grounded reframe
}

// ─── Keyword maps ─────────────────────────────────────────────────────────────

/** Each entry: [pattern, weight] — higher weight = higher intensity contribution */
const EMOTIONAL_PATTERNS: Array<{
  state: EmotionalState;
  patterns: Array<[RegExp, number]>;
}> = [
  {
    state: "panicked",
    patterns: [
      [/\bemergency\b/i, 3],
      [/\bruined?\b/i, 3],
      [/\bfinished\b/i, 2],
      [/\bdisaster\b/i, 3],
      [/we go close/i, 3],
      [/business don die/i, 3],
      [/no more money/i, 3],
    ],
  },
  {
    state: "stressed",
    patterns: [
      [/\bstress(ed|ful)?\b/i, 2],
      [/\bhard\b/i, 1],
      [/\bdifficult\b/i, 2],
      [/\bstruggling\b/i, 2],
      [/\btired\b/i, 1],
      [/\bweary\b/i, 2],
      [/e no easy/i, 2],
      [/things hard/i, 2],
    ],
  },
  {
    state: "frustrated",
    patterns: [
      [/\bangry\b/i, 2],
      [/\bannoyed\b/i, 2],
      [/customers? no pay/i, 3],
      [/tired of\b/i, 2],
      [/sick of\b/i, 2],
      [/i don tire/i, 2],
    ],
  },
  {
    state: "burnt_out",
    patterns: [
      [/give up/i, 3],
      [/too much/i, 2],
      [/can'?t continue/i, 3],
      [/no energy/i, 2],
      [/\bexhausted\b/i, 3],
    ],
  },
  {
    state: "uncertain",
    patterns: [
      [/not sure/i, 1],
      [/\bconfused\b/i, 1],
      [/don'?t know/i, 1],
      [/should i\b/i, 1],
      [/what if\b/i, 1],
      [/\bmaybe\b/i, 1],
    ],
  },
  {
    state: "optimistic",
    patterns: [
      [/\bgrowing\b/i, 2],
      [/\bbetter\b/i, 1],
      [/\bimproving\b/i, 2],
      [/good week/i, 2],
      [/doing well/i, 2],
      [/\bprofit\b/i, 1],
    ],
  },
  {
    state: "confident",
    patterns: [
      [/\bstrong\b/i, 2],
      [/very good/i, 2],
      [/\bexcellent\b/i, 2],
      [/best month/i, 3],
      [/on track/i, 2],
    ],
  },
];

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Detects the dominant emotional state from a message using keyword patterns.
 * Pure function — no AI calls.
 */
export function detectEmotionalState(text: string): EmotionalSignal {
  const scores: Map<EmotionalState, number> = new Map();
  const triggers: string[] = [];

  for (const { state, patterns } of EMOTIONAL_PATTERNS) {
    let stateScore = 0;
    for (const [regex, weight] of patterns) {
      const match = text.match(regex);
      if (match) {
        stateScore += weight;
        triggers.push(match[0]);
      }
    }
    if (stateScore > 0) {
      scores.set(state, (scores.get(state) ?? 0) + stateScore);
    }
  }

  if (scores.size === 0) {
    return { state: "neutral", intensity: "low", triggers: [], operationalContext: null };
  }

  // Pick highest-scoring state; panicked/burnt_out beat stressed on equal score
  let topState: EmotionalState = "neutral";
  let topScore = 0;
  for (const [state, score] of scores.entries()) {
    if (score > topScore) {
      topScore = score;
      topState = state;
    }
  }

  const intensity: EmotionalSignal["intensity"] =
    topScore >= 6 ? "high" : topScore >= 3 ? "medium" : "low";

  return {
    state: topState,
    intensity,
    triggers,
    operationalContext: null, // populated by buildOperationalReassurance callers
  };
}

// ─── Operational reassurance builder ─────────────────────────────────────────

/**
 * Returns a business-grounded reassurance string for the given emotional state.
 * Keeps responses operational — references real metrics, not just feelings.
 */
export function buildOperationalReassurance(
  state: EmotionalState,
  metrics: {
    avgDailyRevenue: number;
    totalDebt: number;
    cashFlowPattern: string;
    riskLevel: string;
  },
): string {
  const { avgDailyRevenue, totalDebt, cashFlowPattern, riskLevel } = metrics;

  const debtFormatted = `GH₵${totalDebt.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  const revenueFormatted = `GH₵${avgDailyRevenue.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  switch (state) {
    case "panicked":
      if (riskLevel === "high" || riskLevel === "HIGH") {
        return `Things are tight right now. Your strongest action is to collect the ${debtFormatted} owed to you before spending more.`;
      }
      return `It feels urgent, but your records show manageable exposure. Your daily revenue average is ${revenueFormatted} — the situation is recoverable.`;

    case "stressed":
      if (cashFlowPattern === "declining") {
        return `Sales slowed this week, but your debt exposure remains manageable. Focus on your top 3 customers this week.`;
      }
      return `Things feel heavy right now, but your cash flow is ${cashFlowPattern}. One step at a time — ZURIA is tracking everything for you.`;

    case "frustrated":
      if (totalDebt > 0) {
        return `Customer debt is a common challenge. ZURIA has tracked ${debtFormatted} owed to you — want a reminder list?`;
      }
      return `Frustration is normal when things don't move as expected. Your recorded data can help you find the bottleneck.`;

    case "burnt_out":
      return `Running a business is exhausting. Your numbers are recorded and safe. Take a moment — ZURIA has your back on the tracking.`;

    case "uncertain":
      return `Uncertainty is a signal to look at the data. Your ZURIA records can give you a clearer picture before you decide.`;

    case "optimistic":
      if (cashFlowPattern === "growing" || cashFlowPattern === "improving") {
        return `You're on a good track. Your revenue this week is above your 7-day average.`;
      }
      return `You're on a good track. Keep recording consistently and ZURIA will show you the full picture.`;

    case "confident":
      return `Strong performance noted. Your records confirm solid momentum — keep it going.`;

    case "neutral":
    default:
      return "";
  }
}

// ─── Guards and enrichment ────────────────────────────────────────────────────

/**
 * Returns true when an emotional layer should be prepended to the response.
 * Positive/neutral states don't need extra reassurance.
 */
export function shouldAddEmotionalLayer(state: EmotionalState): boolean {
  const triggering: EmotionalState[] = [
    "stressed",
    "panicked",
    "frustrated",
    "burnt_out",
    "uncertain",
  ];
  return triggering.includes(state);
}

/**
 * Prepends reassurance to the base response when the emotional state warrants it.
 * Returns the base response unchanged for neutral/optimistic/confident states.
 */
export function enrichResponseWithEmotion(
  baseResponse: string,
  state: EmotionalState,
  reassurance: string,
): string {
  if (!shouldAddEmotionalLayer(state) || reassurance.trim() === "") {
    return baseResponse;
  }
  return `${reassurance}\n\n${baseResponse}`;
}
