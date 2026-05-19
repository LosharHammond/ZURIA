/**
 * lib/business-intelligence/archetypes.ts
 *
 * Business archetype classification system.
 * Maps operational transaction patterns to rich business personas.
 * These archetypes power specialized recommendations, forecasting, and intelligence.
 *
 * Server-only.
 */

import type { BusinessCategory } from "@/types/domain";
import type { BusinessProfile } from "@/lib/memory/operational-memory";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BusinessArchetype =
  | "corner_shop"           // Small provision store, cash-heavy, local
  | "pharmacy"              // Medicine retail, regulated, margin-sensitive
  | "food_vendor"           // Cooked food, perishable inventory
  | "wholesale_distributor" // Bulk buying, many customers, thin margins
  | "salon_barber"          // Service business, appointment-based
  | "electronics_trader"    // Phones, chargers, high-value items
  | "restaurant"            // Table service, high volume, perishable
  | "agro_trader"           // Farm produce, seasonal, price-volatile
  | "spare_parts"           // Vehicle parts, specialized inventory
  | "momo_agent"            // Mobile money, float management
  | "general_trader"        // Mixed goods, undefined category
  | "service_provider";     // Freelancer, contractor, service-only

export interface ArchetypeProfile {
  archetype: BusinessArchetype;
  confidence: number; // 0–1
  traits: string[];   // e.g. ["cash-heavy", "high-debt-culture", "seasonal-demand"]
  risks: string[];    // e.g. ["inventory-spoilage", "customer-debt-buildup"]
  opportunities: string[]; // e.g. ["bulk-supplier-discounts", "loyalty-program"]
  recommendedReportCadence: "daily" | "weekly" | "monthly";
  creditRiskProfile: "low" | "medium" | "high";
  description: string;
}

// ─── Archetype static data ────────────────────────────────────────────────────

interface ArchetypeStaticData {
  traits: string[];
  risks: string[];
  opportunities: string[];
  recommendedReportCadence: "daily" | "weekly" | "monthly";
  creditRiskProfile: "low" | "medium" | "high";
  description: string;
  recommendations: string[];
}

const ARCHETYPE_DATA: Record<BusinessArchetype, ArchetypeStaticData> = {
  corner_shop: {
    traits: ["cash-heavy", "high-debt-culture", "walk-in-customers", "low-ticket-items"],
    risks: ["customer-debt-buildup", "stock-pilferage", "thin-margins", "cash-float-mismanagement"],
    opportunities: ["bulk-supplier-discounts", "loyalty-program", "momo-payment-adoption", "top-up-services"],
    recommendedReportCadence: "daily",
    creditRiskProfile: "medium",
    description: "A small neighbourhood provision shop serving walk-in customers with everyday household goods.",
    recommendations: [
      "Set a maximum credit limit per customer and enforce it consistently",
      "Record every small sale — even GH₵2 items add up significantly over a month",
      "Buy your fastest-moving 5 products in bulk to reduce unit cost",
    ],
  },
  pharmacy: {
    traits: ["regulated-inventory", "margin-sensitive", "prescription-tracking", "expiry-critical"],
    risks: ["medicine-expiry-losses", "regulatory-compliance-gaps", "credit-to-patients", "stockout-risk"],
    opportunities: ["insurance-partnerships", "recurring-prescriptions", "health-product-upsells", "delivery-service"],
    recommendedReportCadence: "daily",
    creditRiskProfile: "low",
    description: "A regulated medicine retail outlet handling prescription and over-the-counter drugs.",
    recommendations: [
      "Track medicine expiry dates to reduce spoilage losses",
      "Maintain a 2-week stock buffer for fast-moving medicines",
      "Record all prescription sales for compliance and reorder planning",
    ],
  },
  food_vendor: {
    traits: ["perishable-inventory", "daily-cash-flow", "high-waste-risk", "weather-sensitive"],
    risks: ["food-spoilage", "inconsistent-daily-revenue", "supplier-price-volatility", "health-compliance"],
    opportunities: ["catering-contracts", "school-feeding-programs", "delivery-partnerships", "pre-orders"],
    recommendedReportCadence: "daily",
    creditRiskProfile: "medium",
    description: "A cooked-food business selling prepared meals with daily perishable inventory cycles.",
    recommendations: [
      "Track daily food waste to identify over-purchasing patterns",
      "Offer pre-orders to reduce waste and guarantee daily revenue",
      "Record your best-selling dishes to optimise your daily menu",
    ],
  },
  wholesale_distributor: {
    traits: ["high-volume", "thin-margins", "many-customers", "bulk-purchasing"],
    risks: ["working-capital-pressure", "customer-debt-accumulation", "logistics-costs", "price-competition"],
    opportunities: ["supplier-rebates", "exclusive-distributor-deals", "digital-ordering", "route-optimisation"],
    recommendedReportCadence: "weekly",
    creditRiskProfile: "high",
    description: "A bulk goods distributor supplying retailers with high transaction volumes and thin margins.",
    recommendations: [
      "Enforce strict 30-day payment terms with all retail customers",
      "Negotiate volume rebates with your top 3 suppliers quarterly",
      "Monitor your working capital weekly — thin margins make cash timing critical",
    ],
  },
  salon_barber: {
    traits: ["service-based", "appointment-driven", "cash-dominant", "repeat-customers"],
    risks: ["staff-dependency", "inconsistent-booking", "no-show-losses", "equipment-downtime"],
    opportunities: ["product-retail-upsells", "loyalty-membership", "online-booking", "bridal-packages"],
    recommendedReportCadence: "weekly",
    creditRiskProfile: "low",
    description: "A personal care service business offering hair, beauty, or barbering on an appointment or walk-in basis.",
    recommendations: [
      "Sell hair and beauty products alongside services to increase revenue per customer",
      "Track your busiest days and hire part-time help on those days only",
      "Introduce a loyalty card — every 5th service free — to retain repeat customers",
    ],
  },
  electronics_trader: {
    traits: ["high-value-items", "low-volume-high-ticket", "warranty-risk", "theft-prone"],
    risks: ["counterfeit-products", "theft-and-shrinkage", "warranty-claims", "rapid-model-obsolescence"],
    opportunities: ["repair-services", "accessories-upsells", "trade-in-programs", "corporate-bulk-orders"],
    recommendedReportCadence: "weekly",
    creditRiskProfile: "medium",
    description: "A trader dealing in phones, accessories, and electronic devices with high-value, low-volume transactions.",
    recommendations: [
      "Record serial numbers for all high-value items to prevent theft disputes",
      "Bundle accessories with every device sale to increase average transaction value",
      "Track which models sell fastest and reorder before stock runs out",
    ],
  },
  restaurant: {
    traits: ["high-volume-perishables", "table-service", "multiple-staff", "daily-cash-cycles"],
    risks: ["food-waste", "staff-theft", "utility-cost-spikes", "health-inspection-risk"],
    opportunities: ["takeaway-expansion", "event-catering", "loyalty-apps", "supplier-credit-terms"],
    recommendedReportCadence: "daily",
    creditRiskProfile: "low",
    description: "A sit-down or counter-service restaurant managing high daily volumes of perishable food and multiple staff.",
    recommendations: [
      "Run a daily end-of-day cash count and reconcile against sales records",
      "Track your top 10 menu items by revenue — cut slow sellers to reduce waste",
      "Negotiate credit terms with your main food suppliers to ease daily cash pressure",
    ],
  },
  agro_trader: {
    traits: ["seasonal-revenue", "price-volatile", "weather-dependent", "perishable-stock"],
    risks: ["seasonal-revenue-gaps", "post-harvest-losses", "transport-costs", "market-price-collapse"],
    opportunities: ["direct-farm-sourcing", "cold-storage-partnerships", "export-markets", "value-added-processing"],
    recommendedReportCadence: "weekly",
    creditRiskProfile: "high",
    description: "A farm produce trader dealing in seasonal, price-volatile agricultural goods with perishable inventory.",
    recommendations: [
      "Record purchase prices and selling prices separately to track your margin per batch",
      "Build a cash reserve during peak season to survive off-season revenue gaps",
      "Track spoilage losses weekly — they are often your biggest hidden cost",
    ],
  },
  spare_parts: {
    traits: ["specialized-inventory", "low-turnover-items", "mechanic-partnerships", "high-search-cost"],
    risks: ["slow-moving-stock", "counterfeit-parts", "credit-to-mechanics", "inventory-complexity"],
    opportunities: ["mechanic-referral-network", "online-parts-listing", "workshop-partnerships", "bulk-import-deals"],
    recommendedReportCadence: "weekly",
    creditRiskProfile: "high",
    description: "A vehicle spare parts dealer stocking specialized components for mechanics and vehicle owners.",
    recommendations: [
      "Identify your top 20 fastest-moving parts and never let them run out",
      "Set credit limits for mechanic partners and review their balances monthly",
      "Record the vehicle model for each part sold — it helps predict restock needs",
    ],
  },
  momo_agent: {
    traits: ["float-management", "fee-income", "high-transaction-volume", "liquidity-critical"],
    risks: ["float-depletion", "network-downtime", "fraud-exposure", "regulatory-changes"],
    opportunities: ["agent-banking-upgrade", "bill-payment-services", "insurance-sales", "merchant-payments"],
    recommendedReportCadence: "daily",
    creditRiskProfile: "low",
    description: "A mobile money agent managing float, processing transfers, and earning commission income.",
    recommendations: [
      "Track your float balance at the start and end of every day",
      "Record each commission earned separately from float movements to see true income",
      "Alert yourself when float drops below GH₵500 to avoid losing transactions",
    ],
  },
  general_trader: {
    traits: ["mixed-inventory", "undefined-niche", "opportunistic-buying", "varied-customers"],
    risks: ["unfocused-inventory", "working-capital-spread-thin", "no-supplier-leverage", "inconsistent-margins"],
    opportunities: ["niche-specialisation", "focus-on-top-sellers", "supplier-consolidation", "customer-segment-focus"],
    recommendedReportCadence: "weekly",
    creditRiskProfile: "medium",
    description: "A general merchandise trader handling mixed goods without a defined product specialisation.",
    recommendations: [
      "Identify your top 5 revenue-generating products and focus your stock on those",
      "Consolidate to 2-3 suppliers to negotiate better prices and payment terms",
      "Record customer names on large purchases to build a repeat-customer database",
    ],
  },
  service_provider: {
    traits: ["no-physical-inventory", "skill-based-income", "project-based-revenue", "low-overhead"],
    risks: ["irregular-income", "single-client-dependency", "late-payment-culture", "no-passive-revenue"],
    opportunities: ["retainer-contracts", "skill-upselling", "referral-income", "digital-service-delivery"],
    recommendedReportCadence: "weekly",
    creditRiskProfile: "medium",
    description: "A freelancer, contractor, or service-only provider with skill-based income and no physical inventory.",
    recommendations: [
      "Invoice every client within 24 hours of job completion to reduce payment delays",
      "Aim to have at least 2 active clients at all times to reduce income dependency risk",
      "Set aside 20% of every payment received for slow months",
    ],
  },
};

// ─── Category → Archetype mapping ────────────────────────────────────────────

const CATEGORY_TO_ARCHETYPE: Record<BusinessCategory, BusinessArchetype> = {
  provision: "corner_shop",
  pharmacy: "pharmacy",
  food: "food_vendor",
  salon: "salon_barber",
  barber: "salon_barber",
  cosmetics: "general_trader",
  restaurant: "restaurant",
  "spare-parts": "spare_parts",
  hardware: "general_trader",
  momo: "momo_agent",
  other: "general_trader",
};

// ─── Classification logic ─────────────────────────────────────────────────────

/**
 * Classify a business into a detailed archetype persona.
 * Pure function — no async, no side effects.
 */
export function classifyArchetype(profile: BusinessProfile): ArchetypeProfile {
  // Start from inferred category
  let archetype: BusinessArchetype =
    profile.inferredCategory !== "unknown"
      ? CATEGORY_TO_ARCHETYPE[profile.inferredCategory]
      : "general_trader";

  let confidence = profile.categoryConfidence;

  // Override/refine based on operational signals
  if (
    profile.activeDebtCount > 20 &&
    profile.averageDailyRevenue > 500
  ) {
    // High volume with many debtors → wholesale distributor
    archetype = "wholesale_distributor";
    confidence = Math.max(confidence, 0.6);
  } else if (
    profile.cashFlowPattern === "stable" &&
    profile.averageDailyRevenue < 30 &&
    profile.preferredPaymentMethod === "cash"
  ) {
    // Very small, cash-only, stable → corner shop
    if (archetype === "general_trader") {
      archetype = "corner_shop";
      confidence = Math.max(confidence, 0.55);
    }
  } else if (
    profile.inferredCategory === "momo" ||
    (profile.preferredPaymentMethod === "momo" && profile.activeDebtCount < 3)
  ) {
    archetype = "momo_agent";
    confidence = Math.max(confidence, 0.7);
  }

  // Boost confidence from high category confidence
  if (profile.categoryConfidence > 0.8) {
    confidence = Math.max(confidence, 0.75);
  }

  // Floor confidence at 0.3 so we always return something useful
  confidence = Math.max(Math.min(confidence, 1), 0.3);

  const data = ARCHETYPE_DATA[archetype];

  return {
    archetype,
    confidence: Math.round(confidence * 100) / 100,
    traits: data.traits,
    risks: data.risks,
    opportunities: data.opportunities,
    recommendedReportCadence: data.recommendedReportCadence,
    creditRiskProfile: data.creditRiskProfile,
    description: data.description,
  };
}

/**
 * Returns 3 actionable recommendation strings for the given archetype.
 */
export function getArchetypeRecommendations(archetype: BusinessArchetype): string[] {
  return ARCHETYPE_DATA[archetype].recommendations;
}

/**
 * Returns a one-sentence description of a business archetype.
 */
export function describeArchetype(archetype: BusinessArchetype): string {
  return ARCHETYPE_DATA[archetype].description;
}
