/**
 * lib/voice/index.ts
 *
 * Voice Intelligence Layer.
 *
 * Analyzes message patterns characteristic of spoken/voice input.
 * Detects urgency, emotional pressure, confusion, stress, and hesitation.
 * Supports English, Pidgin, Twi, Hausa, and hybrid language mixing.
 *
 * "Voice should feel magical."
 *
 * Works on text representations of spoken input — voice note transcriptions,
 * highly colloquial WhatsApp messages, fragmented sentences.
 *
 * Pure functions — no async, no Firestore.
 * Safe for both client-side and server-side use.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type VoiceUrgency = "critical" | "high" | "medium" | "low";
export type DetectedLanguage = "english" | "pidgin" | "twi" | "hausa" | "french" | "mixed";

export interface VoiceSignal {
  urgency: VoiceUrgency;
  detectedLanguage: DetectedLanguage;
  isVoicePattern: boolean;
  emotionalPressure: number;   // 0–1
  confidence: number;           // 0–1
  patterns: string[];           // detected pattern labels
  normalizedText: string;       // cleaned text ready for parser
  languageMix: Array<{ language: string; percentage: number }>;
}

export interface ExtractedEntities {
  amounts: number[];
  names: string[];
  products: string[];
}

// ─── Language Signatures ──────────────────────────────────────────────────────

const PIDGIN_WORDS = [
  "dey", "don", "wahala", "abeg", "make we", "i go", "e be like", "na",
  "oga", "abi", "sha", "jare", "sabi", "waka", "chop", "dem", "wetin",
  "comot", "enter", "ginger", "hustle", "we dey", "i don", "e don",
];

const TWI_WORDS = [
  "mepɛ", "wo", "ɛ", "cedis", "sɛ", "anka", "hwɛ", "enti", "kɔ",
  "bra", "boa", "yɛ", "ɔ", "nti", "ntɛm",
];

const HAUSA_WORDS = [
  "kudi", "kasuwa", "kai", "sai", "da", "zan", "tafi", "gida",
  "abu", "aiki", "nawa", "gari",
];

const FRENCH_FRAGMENTS = [
  "cedis", "aujourd", "très", "aussi", "avec", "mais", "pour", "dans",
];

// ─── Urgency Signatures ───────────────────────────────────────────────────────

const CRITICAL_URGENCY = /\b(emergency|now\s+now|urgent|immediately|right\s+now|asap\s+please|critical|help\s+me)\b/i;
const HIGH_URGENCY     = /\b(quick|fast|hurry|asap|today|right\s+away|at\s+once|quickly)\b/i;
const MEDIUM_URGENCY   = /\b(soon|when\s+you\s+can|later\s+today|this\s+afternoon|in\s+a\s+bit)\b/i;

// ─── Voice Pattern Signatures ────────────────────────────────────────────────

const VOICE_PATTERN_RE = [
  /^[a-z]/i,                           // starts lowercase (natural speech)
  /(.)\1{2,}/,                          // repeated characters ("soooold")
  /\b(um|uh|hmm|like|so|ok|okay)\b/i,  // filler words
  /^\w+\s+\w+\s+\d+/,                  // "rice 50 today" — no grammar
  /[a-z]{2,}\s+\d+\s+[a-z]/i,          // "sold rice 200 yesterday"
];

// ─── Product Trigger Words ────────────────────────────────────────────────────

const PRODUCT_TRIGGERS = [
  "bought", "sold", "purchase", "buy", "sell", "rice", "oil", "bread",
  "water", "malt", "beer", "fuel", "petrol", "medicine", "tablet",
  "phone", "charger", "fabric", "cloth",
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect the primary language of a message (keyword-based, no ML).
 */
export function detectLanguage(text: string): DetectedLanguage {
  const lower = text.toLowerCase();
  const detected: string[] = [];

  const hasPidgin = PIDGIN_WORDS.some((w) => lower.includes(w));
  const hasTwi    = TWI_WORDS.some((w) => lower.includes(w));
  const hasHausa  = HAUSA_WORDS.some((w) => lower.includes(w));
  const hasFrench = FRENCH_FRAGMENTS.some((w) => lower.includes(w));

  if (hasPidgin) detected.push("pidgin");
  if (hasTwi)    detected.push("twi");
  if (hasHausa)  detected.push("hausa");
  if (hasFrench) detected.push("french");

  if (detected.length === 0) return "english";
  if (detected.length === 1) return detected[0] as DetectedLanguage;
  return "mixed";
}

/**
 * Detect urgency level from text content.
 */
export function detectUrgency(text: string): VoiceUrgency {
  if (CRITICAL_URGENCY.test(text)) return "critical";
  if (HIGH_URGENCY.test(text))     return "high";
  if (MEDIUM_URGENCY.test(text))   return "medium";
  return "low";
}

/**
 * Returns true if text looks like spoken/voice-pattern input.
 * Signals: no punctuation, fragmented grammar, filler words, Pidgin mixing.
 */
export function detectVoicePattern(text: string): boolean {
  const trimmed = text.trim();
  const matchCount = VOICE_PATTERN_RE.filter((re) => re.test(trimmed)).length;
  const hasPidgin = PIDGIN_WORDS.some((w) => trimmed.toLowerCase().includes(w));
  const hasNoPunctuation = !/[.!?,;:]/.test(trimmed);
  const isShort = trimmed.split(/\s+/).length < 8;

  return matchCount >= 2 || (hasPidgin && isShort) || (hasNoPunctuation && isShort && matchCount >= 1);
}

/**
 * Full voice signal analysis — runs all detectors and assembles a VoiceSignal.
 */
export function analyzeVoiceSignal(text: string): VoiceSignal {
  const language    = detectLanguage(text);
  const urgency     = detectUrgency(text);
  const isVoice     = detectVoicePattern(text);
  const patterns: string[] = [];

  if (isVoice)           patterns.push("voice_pattern");
  if (language !== "english") patterns.push(`${language}_phrase`);

  // Urgency contribution
  const urgencyPressure: Record<VoiceUrgency, number> = {
    critical: 0.8, high: 0.5, medium: 0.2, low: 0.0,
  };

  // Emotional stress keywords add pressure
  const stressRe = /\b(stressed|hard|difficult|struggling|tired|panic|problem|issue|emergency|help)\b/i;
  const stressPressure = stressRe.test(text) ? 0.2 : 0;

  const emotionalPressure = Math.min(1, urgencyPressure[urgency] + stressPressure);

  // Build language mix
  const lower = text.toLowerCase();
  const langMix: Array<{ language: string; percentage: number }> = [];
  const words = lower.split(/\s+/);
  const total = Math.max(words.length, 1);

  const pidginCount = words.filter((w) => PIDGIN_WORDS.includes(w)).length;
  const twiCount    = words.filter((w) => TWI_WORDS.includes(w)).length;
  if (pidginCount > 0) langMix.push({ language: "pidgin", percentage: Math.round((pidginCount / total) * 100) });
  if (twiCount > 0)    langMix.push({ language: "twi",    percentage: Math.round((twiCount    / total) * 100) });
  const otherPct = 100 - langMix.reduce((a, b) => a + b.percentage, 0);
  if (otherPct > 0) langMix.push({ language: "english", percentage: otherPct });

  const confidence = isVoice ? 0.75 : 0.50;

  return {
    urgency,
    detectedLanguage: language,
    isVoicePattern:   isVoice,
    emotionalPressure,
    confidence,
    patterns,
    normalizedText: normalizeVoiceInput(text, language),
    languageMix: langMix,
  };
}

/**
 * Normalize voice/spoken input to standard text suitable for the parser.
 */
export function normalizeVoiceInput(text: string, language: DetectedLanguage): string {
  let out = text.trim().toLowerCase();

  // Fix common transcription errors
  out = out.replace(/\bghc\b/gi, "GH₵");
  out = out.replace(/\bcedi\b/gi, "cedis");
  out = out.replace(/\bgh₵\b/gi, "GH₵");

  // Pidgin normalizations
  if (language === "pidgin" || language === "mixed") {
    out = out.replace(/\bi don pay\b/gi, "I paid");
    out = out.replace(/\bi go pay\b/gi, "I will pay");
    out = out.replace(/\be don finish\b/gi, "it is finished");
    out = out.replace(/\bwe dey\b/gi, "we are");
    out = out.replace(/\babeg\b/gi, "please");
  }

  // Twi normalizations
  if (language === "twi" || language === "mixed") {
    out = out.replace(/\bmepɛ\b/gi, "I want to buy");
  }

  // Collapse multiple spaces
  out = out.replace(/\s{2,}/g, " ").trim();

  return out;
}

/**
 * Quick entity extraction from voice-patterned text.
 */
export function extractUrgentEntities(text: string): ExtractedEntities {
  const amounts: number[] = [];
  const names: string[]   = [];
  const products: string[] = [];

  // Extract amounts
  let match: RegExpExecArray | null;
  const amountRe = /(?:gh[c₵]|cedis?)?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:gh[c₵]|cedis?)?/gi;
  while ((match = amountRe.exec(text)) !== null) {
    const num = parseFloat(match[1].replace(/,/g, ""));
    if (!isNaN(num) && num > 0) amounts.push(num);
  }

  // Extract capitalized names (not at sentence start)
  const words = text.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    if (/^[A-Z][a-z]{2,}$/.test(word) && !PRODUCT_TRIGGERS.includes(word.toLowerCase())) {
      names.push(word);
    }
  }

  // Extract products (words after trigger words)
  for (let i = 0; i < words.length - 1; i++) {
    const lower = words[i].toLowerCase();
    if (PRODUCT_TRIGGERS.includes(lower)) {
      const next = words[i + 1];
      if (next && /^[a-z]{2,}$/i.test(next) && !["for", "the", "a", "an", "my", "your"].includes(next.toLowerCase())) {
        products.push(next.toLowerCase());
      }
    }
  }

  return {
    amounts: [...new Set(amounts)],
    names:   [...new Set(names)],
    products:[...new Set(products)],
  };
}
