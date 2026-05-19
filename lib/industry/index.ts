/**
 * lib/industry/index.ts
 *
 * Industry-Specific Intelligence.
 *
 * Specialized intelligence modules for major African SME verticals:
 *   - Pharmacy memory
 *   - Retail/provision memory
 *   - Restaurant/food vendor memory
 *   - Wholesale distributor memory
 *   - Salon/barber memory
 *   - Spare parts memory
 *   - Agro-business memory
 *
 * Each vertical gains specialized reports, forecasting, inventory logic,
 * and domain-specific recommendations.
 *
 * Server-only.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type IndustryVertical =
  | "pharmacy"
  | "provision_retail"
  | "food_restaurant"
  | "wholesale_distributor"
  | "salon_barber"
  | "spare_parts"
  | "agro_business"
  | "electronics_trader"
  | "general_retail";

export interface IndustryIntelligence {
  vertical: IndustryVertical;

  // Specialized metrics
  keyPerformanceIndicators: KPI[];

  // Industry-specific warnings
  warnings: IndustryWarning[];

  // Domain recommendations
  recommendations: string[];

  // Specialized inventory rules
  inventoryRules: InventoryRule[];

  // Industry benchmarks (what's normal for this type)
  benchmarks: IndustryBenchmark;
}

export interface KPI {
  name: string;
  value: number;
  unit: string;
  benchmark: number;    // industry typical value
  status: "good" | "warning" | "critical";
  description: string;
}

export interface IndustryWarning {
  code: string;
  message: string;
  severity: "critical" | "warning" | "info";
}

export interface InventoryRule {
  category: string;
  minStockDays: number;    // minimum days of stock to maintain
  reorderPoint: number;    // units at which to reorder
  shelfLifeDays: number | null; // null for non-perishable
  specialHandling: string | null;
}

export interface IndustryBenchmark {
  typicalGrossMargin: number;  // 0–1
  typicalExpenseRatio: number; // 0–1
  avgInventoryTurnover: number; // times per month
  creditSalesRatio: number;     // % sales on credit
  description: string;
}

// ─── detectIndustryVertical ───────────────────────────────────────────────────

/**
 * Maps a business category string (and optional product names) to an
 * IndustryVertical.  Case-insensitive keyword matching.
 */
export function detectIndustryVertical(
  businessCategory: string,
  productNames: string[],
): IndustryVertical {
  const cat = businessCategory.toLowerCase();
  const products = productNames.map((p) => p.toLowerCase()).join(" ");
  const combined = `${cat} ${products}`;

  if (/pharma|drug|medicine|chemist|clinic|health/.test(combined)) return "pharmacy";

  if (/restaurant|food|chop|canteen|catering|waakye|kenkey|fufu|rice.*joint|cook/.test(combined))
    return "food_restaurant";

  if (/salon|barber|hairdress|beauty|nail|spa/.test(combined)) return "salon_barber";

  if (/spare.?part|mechanic|auto|vehicle|engine|motor/.test(combined)) return "spare_parts";

  if (/wholesale|distributor|distribution|bulk.?supply/.test(combined))
    return "wholesale_distributor";

  if (/agro|farm|agriculture|seed|fertilizer|crop|maize|cocoa|cassava/.test(combined))
    return "agro_business";

  if (/electron|gadget|phone|computer|laptop|tv|appliance/.test(combined))
    return "electronics_trader";

  if (
    /provision|grocery|shop|store|market|retail|momo|supermarket|mini.?mart/.test(combined)
  )
    return "provision_retail";

  return "general_retail";
}

// ─── getIndustryBenchmarks ────────────────────────────────────────────────────

/**
 * Returns typical industry benchmarks for each vertical.
 */
export function getIndustryBenchmarks(vertical: IndustryVertical): IndustryBenchmark {
  switch (vertical) {
    case "pharmacy":
      return {
        typicalGrossMargin: 0.30,
        typicalExpenseRatio: 0.45,
        avgInventoryTurnover: 8,
        creditSalesRatio: 0.10,
        description: "Pharmacy — regulated margins, low credit, high stock discipline required.",
      };

    case "food_restaurant":
      return {
        typicalGrossMargin: 0.40,
        typicalExpenseRatio: 0.60,
        avgInventoryTurnover: 30,
        creditSalesRatio: 0.05,
        description: "Food & restaurant — high turnover, mostly cash, perishable stock risk.",
      };

    case "wholesale_distributor":
      return {
        typicalGrossMargin: 0.12,
        typicalExpenseRatio: 0.70,
        avgInventoryTurnover: 15,
        creditSalesRatio: 0.40,
        description: "Wholesale — thin margins, high credit exposure, volume-driven profitability.",
      };

    case "provision_retail":
      return {
        typicalGrossMargin: 0.20,
        typicalExpenseRatio: 0.55,
        avgInventoryTurnover: 12,
        creditSalesRatio: 0.15,
        description: "Provision/grocery — moderate margins, community credit common.",
      };

    case "salon_barber":
      return {
        typicalGrossMargin: 0.65,
        typicalExpenseRatio: 0.35,
        avgInventoryTurnover: 2,
        creditSalesRatio: 0.05,
        description: "Salon/barber — high service margin, low inventory needs, mostly cash.",
      };

    case "spare_parts":
      return {
        typicalGrossMargin: 0.35,
        typicalExpenseRatio: 0.50,
        avgInventoryTurnover: 3,
        creditSalesRatio: 0.25,
        description: "Spare parts — good margins, slow turnover, trade credit common.",
      };

    case "agro_business":
      return {
        typicalGrossMargin: 0.18,
        typicalExpenseRatio: 0.60,
        avgInventoryTurnover: 20,
        creditSalesRatio: 0.20,
        description: "Agro-business — seasonal, thin margins, high turnover during harvest.",
      };

    case "electronics_trader":
      return {
        typicalGrossMargin: 0.22,
        typicalExpenseRatio: 0.55,
        avgInventoryTurnover: 4,
        creditSalesRatio: 0.20,
        description: "Electronics — moderate margins, slow turnover, high-value stock.",
      };

    case "general_retail":
    default:
      return {
        typicalGrossMargin: 0.25,
        typicalExpenseRatio: 0.55,
        avgInventoryTurnover: 10,
        creditSalesRatio: 0.15,
        description: "General retail — average benchmarks across SME retail segment.",
      };
  }
}

// ─── getInventoryRules ────────────────────────────────────────────────────────

/**
 * Returns 2-4 inventory rules per vertical.
 */
export function getInventoryRules(vertical: IndustryVertical): InventoryRule[] {
  switch (vertical) {
    case "pharmacy":
      return [
        {
          category: "Prescription medicines",
          minStockDays: 14,
          reorderPoint: 10,
          shelfLifeDays: 365,
          specialHandling: "Store in cool, dry place. Check expiry on every delivery.",
        },
        {
          category: "OTC medicines",
          minStockDays: 14,
          reorderPoint: 20,
          shelfLifeDays: 730,
          specialHandling: "Rotate stock FIFO. Flag items within 90 days of expiry.",
        },
        {
          category: "Medical supplies",
          minStockDays: 7,
          reorderPoint: 15,
          shelfLifeDays: null,
          specialHandling: null,
        },
        {
          category: "Refrigerated items",
          minStockDays: 7,
          reorderPoint: 5,
          shelfLifeDays: 90,
          specialHandling: "Maintain cold chain. 2–8°C at all times.",
        },
      ];

    case "food_restaurant":
      return [
        {
          category: "Fresh produce",
          minStockDays: 1,
          reorderPoint: 2,
          shelfLifeDays: 3,
          specialHandling: "Daily fresh purchase preferred. Discard after 3 days.",
        },
        {
          category: "Dry goods / staples",
          minStockDays: 7,
          reorderPoint: 5,
          shelfLifeDays: 180,
          specialHandling: "Store in airtight containers, away from moisture.",
        },
        {
          category: "Cooking oil",
          minStockDays: 7,
          reorderPoint: 3,
          shelfLifeDays: 365,
          specialHandling: null,
        },
      ];

    case "wholesale_distributor":
      return [
        {
          category: "Fast-moving goods",
          minStockDays: 14,
          reorderPoint: 50,
          shelfLifeDays: null,
          specialHandling: "Maintain safety stock for 2 weeks of average demand.",
        },
        {
          category: "Perishable wholesale stock",
          minStockDays: 3,
          reorderPoint: 20,
          shelfLifeDays: 14,
          specialHandling: "FIFO rotation. Check delivery dates on all inbound stock.",
        },
        {
          category: "Seasonal goods",
          minStockDays: 30,
          reorderPoint: 100,
          shelfLifeDays: null,
          specialHandling: "Buy ahead of peak season. Liquidate before season ends.",
        },
      ];

    case "provision_retail":
      return [
        {
          category: "Packaged food",
          minStockDays: 7,
          reorderPoint: 10,
          shelfLifeDays: 180,
          specialHandling: null,
        },
        {
          category: "Drinks & beverages",
          minStockDays: 5,
          reorderPoint: 10,
          shelfLifeDays: 365,
          specialHandling: null,
        },
        {
          category: "Fresh items",
          minStockDays: 2,
          reorderPoint: 5,
          shelfLifeDays: 5,
          specialHandling: "Check daily. Discard visibly spoiled stock.",
        },
      ];

    case "salon_barber":
      return [
        {
          category: "Hair products",
          minStockDays: 14,
          reorderPoint: 3,
          shelfLifeDays: 730,
          specialHandling: "Store away from direct sunlight.",
        },
        {
          category: "Disposables (gloves, caps)",
          minStockDays: 14,
          reorderPoint: 20,
          shelfLifeDays: null,
          specialHandling: null,
        },
      ];

    case "spare_parts":
      return [
        {
          category: "Fast-moving parts",
          minStockDays: 30,
          reorderPoint: 5,
          shelfLifeDays: null,
          specialHandling: "Track part numbers. Keep catalogue up to date.",
        },
        {
          category: "Slow-moving / specialty parts",
          minStockDays: 90,
          reorderPoint: 1,
          shelfLifeDays: null,
          specialHandling: "Order on demand where possible to avoid over-stocking.",
        },
        {
          category: "Lubricants & fluids",
          minStockDays: 14,
          reorderPoint: 5,
          shelfLifeDays: 730,
          specialHandling: "Sealed storage. Check for leaks on all containers.",
        },
      ];

    case "agro_business":
      return [
        {
          category: "Seeds",
          minStockDays: 30,
          reorderPoint: 10,
          shelfLifeDays: 365,
          specialHandling: "Store in cool dry place. Test germination rate each season.",
        },
        {
          category: "Fertilizer",
          minStockDays: 30,
          reorderPoint: 20,
          shelfLifeDays: 730,
          specialHandling: "Avoid moisture. Seal bags after opening.",
        },
        {
          category: "Harvested produce",
          minStockDays: 7,
          reorderPoint: 0,
          shelfLifeDays: 30,
          specialHandling: "Move to market quickly. Cold storage where available.",
        },
      ];

    case "electronics_trader":
      return [
        {
          category: "Mobile phones",
          minStockDays: 30,
          reorderPoint: 3,
          shelfLifeDays: null,
          specialHandling: "Anti-static storage. Keep IMEI records for all units.",
        },
        {
          category: "Accessories",
          minStockDays: 14,
          reorderPoint: 10,
          shelfLifeDays: null,
          specialHandling: null,
        },
      ];

    case "general_retail":
    default:
      return [
        {
          category: "General merchandise",
          minStockDays: 7,
          reorderPoint: 5,
          shelfLifeDays: null,
          specialHandling: null,
        },
        {
          category: "Perishable goods",
          minStockDays: 3,
          reorderPoint: 3,
          shelfLifeDays: 7,
          specialHandling: "Check expiry on all incoming stock.",
        },
      ];
  }
}

// ─── generateIndustryWarnings ─────────────────────────────────────────────────

export interface IndustryWarningParams {
  expenseRatio: number;
  debtRatio: number;
  avgDailyRevenue: number;
  totalDebt: number;
}

/**
 * Generates vertical-specific operational warnings based on financial parameters.
 */
export function generateIndustryWarnings(
  vertical: IndustryVertical,
  params: IndustryWarningParams,
): IndustryWarning[] {
  const warnings: IndustryWarning[] = [];
  const { expenseRatio, debtRatio, avgDailyRevenue, totalDebt } = params;

  switch (vertical) {
    case "pharmacy":
      if (expenseRatio > 0.55) {
        warnings.push({
          code: "PHARMACY_HIGH_EXPENSES",
          message: `Expense ratio is ${(expenseRatio * 100).toFixed(1)}% — unusually high for a pharmacy (benchmark 45%). Review staff costs and overheads.`,
          severity: "warning",
        });
      }
      if (debtRatio > 0.3) {
        warnings.push({
          code: "PHARMACY_CREDIT_RISK",
          message: "Credit sales ratio is high for a pharmacy. Medicines on credit increase collection risk.",
          severity: "warning",
        });
      }
      break;

    case "food_restaurant":
      if (debtRatio > 0.5) {
        warnings.push({
          code: "FOOD_HIGH_CREDIT",
          message: `Debt ratio is ${(debtRatio * 100).toFixed(1)}% — high for a food business. Perishable stock means unpaid debt is especially risky.`,
          severity: "critical",
        });
      }
      if (expenseRatio > 0.70) {
        warnings.push({
          code: "FOOD_HIGH_EXPENSES",
          message: `Expense ratio ${(expenseRatio * 100).toFixed(1)}% exceeds the 60% food-business benchmark. Likely food waste or over-staffing.`,
          severity: "warning",
        });
      }
      break;

    case "wholesale_distributor":
      if (debtRatio > 2.0) {
        warnings.push({
          code: "WHOLESALE_HIGH_CREDIT_EXPOSURE",
          message: `Outstanding debt is ${debtRatio.toFixed(1)}× daily revenue — dangerously high credit exposure for a distributor.`,
          severity: "critical",
        });
      }
      if (totalDebt > avgDailyRevenue * 30) {
        warnings.push({
          code: "WHOLESALE_DEBT_30_DAYS",
          message: "Total outstanding debt exceeds 30 days of revenue. Pursue aggressive collection.",
          severity: "warning",
        });
      }
      break;

    case "salon_barber":
      if (expenseRatio > 0.50) {
        warnings.push({
          code: "SALON_HIGH_EXPENSES",
          message: `Expense ratio ${(expenseRatio * 100).toFixed(1)}% is above 50% — service businesses should run leaner (benchmark 35%). Check rent and product costs.`,
          severity: "warning",
        });
      }
      break;

    case "spare_parts":
      if (debtRatio > 1.5) {
        warnings.push({
          code: "SPARE_PARTS_CREDIT_RISK",
          message: "Outstanding credit is very high relative to daily revenue. Parts given on credit often go unpaid — tighten credit terms.",
          severity: "warning",
        });
      }
      break;

    case "agro_business":
      if (expenseRatio > 0.70) {
        warnings.push({
          code: "AGRO_HIGH_EXPENSES",
          message: "Expense ratio is above 70% — agro-businesses are low-margin; high expenses threaten viability.",
          severity: "critical",
        });
      }
      break;

    case "provision_retail":
      if (debtRatio > 1.0) {
        warnings.push({
          code: "PROVISION_HIGH_CREDIT",
          message: "Community credit (goods given on account) exceeds one day's revenue. Set strict credit limits.",
          severity: "warning",
        });
      }
      break;

    default:
      if (expenseRatio > 0.70) {
        warnings.push({
          code: "GENERAL_HIGH_EXPENSES",
          message: `Expense ratio of ${(expenseRatio * 100).toFixed(1)}% is very high. Review all overhead costs.`,
          severity: "warning",
        });
      }
  }

  return warnings;
}

// ─── buildIndustryIntelligence ────────────────────────────────────────────────

export interface IndustryIntelligenceParams {
  expenseRatio: number;
  debtRatio: number;
  avgDailyRevenue: number;
  totalDebt: number;
  productNames: string[];
}

function kpiStatus(value: number, benchmark: number): "good" | "warning" | "critical" {
  const pctOff = Math.abs(value - benchmark) / (benchmark || 1);
  if (pctOff <= 0.10) return "good";
  if (pctOff <= 0.30) return "warning";
  return "critical";
}

/**
 * Assembles a full IndustryIntelligence object for a given vertical and set of
 * financial parameters.
 */
export function buildIndustryIntelligence(
  vertical: IndustryVertical,
  params: IndustryIntelligenceParams,
): IndustryIntelligence {
  const { expenseRatio, debtRatio, avgDailyRevenue, totalDebt, productNames } = params;
  const benchmarks = getIndustryBenchmarks(vertical);
  const inventoryRules = getInventoryRules(vertical);
  const warnings = generateIndustryWarnings(vertical, { expenseRatio, debtRatio, avgDailyRevenue, totalDebt });

  // Approximate gross margin from expense ratio: grossMargin ≈ 1 - expenseRatio
  const approxGrossMargin = Math.max(0, 1 - expenseRatio);

  const keyPerformanceIndicators: KPI[] = [
    {
      name: "Gross Margin",
      value: approxGrossMargin,
      unit: "%",
      benchmark: benchmarks.typicalGrossMargin,
      status: kpiStatus(approxGrossMargin, benchmarks.typicalGrossMargin),
      description: "Estimated gross margin based on expense ratio. Compare to industry benchmark.",
    },
    {
      name: "Expense Ratio",
      value: expenseRatio,
      unit: "%",
      benchmark: benchmarks.typicalExpenseRatio,
      status: kpiStatus(expenseRatio, benchmarks.typicalExpenseRatio),
      description: "Total expenses as a proportion of revenue.",
    },
    {
      name: "Debt Ratio",
      value: debtRatio,
      unit: "× daily revenue",
      benchmark: benchmarks.creditSalesRatio,
      status: kpiStatus(debtRatio, benchmarks.creditSalesRatio),
      description: "Outstanding customer debt relative to daily revenue.",
    },
    {
      name: "Daily Revenue",
      value: avgDailyRevenue,
      unit: "GH₵/day",
      benchmark: avgDailyRevenue, // no universal benchmark; track trend
      status: "good",
      description: "Average daily revenue for this period.",
    },
  ];

  // Build recommendations based on vertical and KPI statuses
  const recommendations: string[] = [];
  const marginKpi = keyPerformanceIndicators[0];
  const expenseKpi = keyPerformanceIndicators[1];
  const debtKpi = keyPerformanceIndicators[2];

  if (marginKpi.status === "critical") {
    recommendations.push(
      `Your gross margin (${(approxGrossMargin * 100).toFixed(1)}%) is well below the ${vertical.replace(/_/g, " ")} benchmark of ${(benchmarks.typicalGrossMargin * 100).toFixed(0)}%. Review your pricing strategy.`,
    );
  }
  if (expenseKpi.status !== "good") {
    recommendations.push(
      `Expense ratio is ${expenseKpi.status === "critical" ? "critically" : "moderately"} above benchmark. Identify your top 3 expense categories and find at least one to reduce.`,
    );
  }
  if (debtKpi.status !== "good") {
    recommendations.push(
      `Outstanding debt is ${debtKpi.status === "critical" ? "dangerously" : "somewhat"} elevated. Set a weekly collections target and contact overdue customers.`,
    );
  }
  if (productNames.length === 0) {
    recommendations.push(
      "Track individual product sales to identify your best and worst performers.",
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      "Key metrics look healthy! Focus on growing revenue and maintaining current expense discipline.",
    );
  }

  return {
    vertical,
    keyPerformanceIndicators,
    warnings,
    recommendations,
    inventoryRules,
    benchmarks,
  };
}
