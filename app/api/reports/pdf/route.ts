import { type NextRequest, NextResponse } from "next/server";
import { verifyIdToken, getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import type { SubscriptionPlan, Transaction, Debt, TransactionType } from "@/types/domain";
import { MONEY_IN_TYPES, MONEY_OUT_TYPES, REVENUE_TYPES, OPERATING_COST_TYPES } from "@/types/domain";

// Friendly cost-category labels for PDF reports (shorter than TRANSACTION_TYPE_LABELS)
const COST_LABEL: Partial<Record<TransactionType, string>> = {
  expense:        "General Expenses",
  stock_purchase: "Goods & Stock",
  cost:           "Business Bills",
  salary:         "Worker Pay",
  tax:            "Tax & Levies",
};

export const dynamic = "force-dynamic";

// Plans allowed to download PDF reports (Growth and above)
const PDF_ALLOWED_PLANS: SubscriptionPlan[] = ["growth", "pro", "enterprise"];

function isExpired(expiresAt?: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) <= new Date();
}

function fmt(n: number) {
  return `GHS ${Math.abs(n).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function sum(txns: Transaction[]): number {
  return txns.reduce((acc, t) => acc + t.amount, 0);
}

// GET /api/reports/pdf?type=monthly|weekly|daily
export async function GET(req: NextRequest) {
  const decoded = await verifyIdToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();
  const uid = decoded.uid;

  // Load user + check subscription
  const userSnap = await db.collection(collections.users).doc(uid).get();
  if (!userSnap.exists) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const userData = userSnap.data()!;

  const plan = (userData.subscriptionPlan as SubscriptionPlan) ?? "free";
  const expiresAt = userData.subscriptionExpiresAt as string | null;
  const effectivePlan: SubscriptionPlan = (plan !== "free" && !isExpired(expiresAt)) ? plan : "free";

  if (!PDF_ALLOWED_PLANS.includes(effectivePlan)) {
    return NextResponse.json({ error: "PDF reports require ZURIA Growth or above." }, { status: 403 });
  }

  // Load business
  const businessId = userData.businessId as string | undefined;
  if (!businessId) return NextResponse.json({ error: "No business found" }, { status: 404 });
  const bizSnap = await db.collection(collections.businesses).doc(businessId).get();
  const biz = bizSnap.data() ?? {};

  const reportType = (req.nextUrl.searchParams.get("type") ?? "monthly") as "daily" | "weekly" | "monthly";
  const ownerName = (userData.ownerName as string) ?? "Business Owner";
  const businessName = (biz.name as string) ?? "Your Business";
  const now = new Date();

  // Date range
  let startDate: string;
  let reportLabel: string;
  if (reportType === "daily") {
    startDate = now.toISOString().slice(0, 10);
    reportLabel = `Daily Report — ${now.toLocaleDateString("en-GH", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`;
  } else if (reportType === "weekly") {
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - diff);
    weekStart.setHours(0, 0, 0, 0);
    startDate = weekStart.toISOString().slice(0, 10);
    reportLabel = `Weekly Report — ${weekStart.toLocaleDateString("en-GH", { day: "numeric", month: "short" })} – ${now.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" })}`;
  } else {
    startDate = now.toISOString().slice(0, 7); // YYYY-MM
    reportLabel = `Monthly Report — ${now.toLocaleDateString("en-GH", { month: "long", year: "numeric" })}`;
  }

  // Load transactions
  const txSnap = await db
    .collection(collections.transactions)
    .where("businessId", "==", businessId)
    .orderBy("createdAt", "desc")
    .limit(500)
    .get();

  const allTxns: Transaction[] = txSnap.docs.map((d) => {
    const data = d.data();
    return {
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() ?? data.createdAt,
    } as Transaction;
  });

  const txns = allTxns.filter((t) => {
    const dateStr = t.createdAt.slice(0, reportType === "monthly" ? 7 : 10);
    return reportType === "monthly" ? dateStr >= startDate.slice(0, 7) : dateStr >= startDate;
  });

  // Load debts
  const debtSnap = await db
    .collection(collections.debts)
    .where("businessId", "==", businessId)
    .where("status", "==", "open")
    .get();
  const debts: Debt[] = debtSnap.docs.map((d) => d.data() as Debt);
  const totalDebt = debts.reduce((a, d) => a + d.outstandingAmount, 0);

  // Aggregates
  const moneyIn = sum(txns.filter((t) => MONEY_IN_TYPES.includes(t.type)));
  const moneyOut = sum(txns.filter((t) => MONEY_OUT_TYPES.includes(t.type)));
  const revenue = sum(txns.filter((t) => REVENUE_TYPES.includes(t.type)));
  const costs = sum(txns.filter((t) => OPERATING_COST_TYPES.includes(t.type)));
  const profit = revenue - costs;
  const netCash = moneyIn - moneyOut;

  // Build HTML
  const generatedAt = now.toLocaleString("en-GH", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  // Cost breakdown by type (for monthly reports) — use friendly labels
  const costBreakdown: Record<string, number> = {};
  txns.filter((t) => OPERATING_COST_TYPES.includes(t.type)).forEach((t) => {
    const label = COST_LABEL[t.type as TransactionType] ?? t.type.replace(/_/g, " ");
    costBreakdown[label] = (costBreakdown[label] ?? 0) + t.amount;
  });

  // Daily breakdown (for weekly reports)
  let dailyBreakdown: { date: string; revenue: number; costs: number; net: number }[] = [];
  if (reportType === "weekly") {
    const map = new Map<string, { revenue: number; costs: number }>();
    txns.forEach((t) => {
      const day = t.createdAt.slice(0, 10);
      const cur = map.get(day) ?? { revenue: 0, costs: 0 };
      if (REVENUE_TYPES.includes(t.type))        cur.revenue += t.amount;
      if (OPERATING_COST_TYPES.includes(t.type)) cur.costs   += t.amount;
      map.set(day, cur);
    });
    dailyBreakdown = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, revenue: v.revenue, costs: v.costs, net: v.revenue - v.costs }));
  }

  const html = buildPdfHtml({
    reportLabel,
    reportType,
    ownerName,
    businessName,
    plan: effectivePlan,
    generatedAt,
    revenue,
    costs,
    profit,
    moneyIn,
    moneyOut,
    netCash,
    totalDebt,
    debtCount: debts.length,
    txns: txns.slice(0, 60),
    debts: debts.slice(0, 20),
    costBreakdown,
    dailyBreakdown,
  });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

interface ReportData {
  reportLabel: string;
  reportType: "daily" | "weekly" | "monthly";
  ownerName: string;
  businessName: string;
  plan: SubscriptionPlan;
  generatedAt: string;
  revenue: number;
  costs: number;
  profit: number;
  moneyIn: number;
  moneyOut: number;
  netCash: number;
  totalDebt: number;
  debtCount: number;
  txns: Transaction[];
  debts: Debt[];
  costBreakdown: Record<string, number>;
  dailyBreakdown: { date: string; revenue: number; costs: number; net: number }[];
}

function buildPdfHtml(d: ReportData): string {
  const planLabel = d.plan === "growth" ? "ZURIA Growth" : d.plan === "pro" ? "ZURIA Pro" : "ZURIA Enterprise";
  const profitColor = d.profit >= 0 ? "#10b981" : "#f43f5e";
  const profitSign  = d.profit >= 0 ? "+" : "−";
  const marginPct   = d.revenue > 0 ? Math.round((d.profit / d.revenue) * 100) : 0;

  const txRows = d.txns.map((t) => {
    const isIn  = MONEY_IN_TYPES.includes(t.type);
    const isOut = MONEY_OUT_TYPES.includes(t.type);
    const color = isIn ? "#10b981" : isOut ? "#f43f5e" : "#94a3b8";
    const sign  = isIn ? "+" : isOut ? "−" : "";
    const date  = new Date(t.createdAt).toLocaleDateString("en-GH", { day: "numeric", month: "short" });
    const desc  = (t.productName || t.rawText || "—").slice(0, 55);
    return `
      <tr>
        <td style="padding:9px 12px;color:#64748b;font-size:11px;white-space:nowrap;">${date}</td>
        <td style="padding:9px 12px;font-size:11px;color:#334155;">${desc}</td>
        <td style="padding:9px 12px;font-size:11px;text-transform:capitalize;color:#64748b;">${t.type.replace(/_/g, " ")}</td>
        <td style="padding:9px 12px;font-size:12px;font-weight:700;color:${color};text-align:right;white-space:nowrap;">${sign}${fmt(t.amount)}</td>
      </tr>`;
  }).join("\n");

  const debtRows = d.debts.map((debt) => `
    <tr>
      <td style="padding:8px 12px;font-size:12px;">${debt.customerName ?? "Unknown"}</td>
      <td style="padding:8px 12px;font-size:12px;font-weight:700;color:#f59e0b;text-align:right;">${fmt(debt.outstandingAmount)}</td>
    </tr>`).join("\n");

  const costRows = Object.entries(d.costBreakdown)
    .sort(([,a],[,b]) => b - a)
    .map(([label, amt]) => `
    <tr>
      <td style="padding:8px 12px;font-size:12px;text-transform:capitalize;">${label}</td>
      <td style="padding:8px 12px;font-size:12px;font-weight:700;color:#f43f5e;text-align:right;">${fmt(amt)}</td>
      <td style="padding:8px 12px;font-size:11px;color:#94a3b8;text-align:right;">${d.costs > 0 ? Math.round((amt/d.costs)*100) : 0}%</td>
    </tr>`).join("\n");

  const dailyRows = d.dailyBreakdown.map((row) => {
    const label = new Date(row.date + "T00:00:00").toLocaleDateString("en-GH", { weekday: "short", day: "numeric", month: "short" });
    const netColor = row.net >= 0 ? "#10b981" : "#f43f5e";
    return `
    <tr>
      <td style="padding:8px 12px;font-size:12px;color:#334155;">${label}</td>
      <td style="padding:8px 12px;font-size:12px;font-weight:600;color:#10b981;text-align:right;">${fmt(row.revenue)}</td>
      <td style="padding:8px 12px;font-size:12px;font-weight:600;color:#f43f5e;text-align:right;">${fmt(row.costs)}</td>
      <td style="padding:8px 12px;font-size:12px;font-weight:700;color:${netColor};text-align:right;">${row.net >= 0 ? "+" : "−"}${fmt(Math.abs(row.net))}</td>
    </tr>`;
  }).join("\n");

  const healthColor = marginPct >= 20 ? "#10b981" : marginPct >= 5 ? "#f59e0b" : "#f43f5e";
  const healthLabel = marginPct >= 20 ? "Healthy" : marginPct >= 5 ? "Moderate" : marginPct >= 0 ? "Slim margin" : "Loss";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${d.reportLabel} — ${d.businessName}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap" rel="stylesheet" />
  <style>
    @page { margin: 0; size: A4; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      max-width: 800px;
      margin: 0 auto;
      background: #ffffff;
      min-height: 100vh;
      box-shadow: 0 0 40px rgba(0,0,0,0.08);
    }
    /* ── Header ── */
    .header {
      background: linear-gradient(135deg, #071514 0%, #0d2626 60%, #071514 100%);
      padding: 36px 40px 30px;
      position: relative;
      overflow: hidden;
    }
    .header::before {
      content: '';
      position: absolute;
      top: -80px; left: 40%;
      width: 500px; height: 500px;
      background: radial-gradient(circle, rgba(79,209,197,0.10) 0%, transparent 65%);
    }
    .header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 22px;
    }
    .logo { display: flex; align-items: center; gap: 12px; }
    .logo-icon {
      width: 44px; height: 44px;
      background: #4fd1c5;
      border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; font-weight: 900; color: #071514;
    }
    .logo-name { font-size: 16px; font-weight: 900; letter-spacing: 0.2em; color: #fff; }
    .logo-sub  { font-size: 11px; color: #4fd1c5; margin-top: 2px; }
    .plan-badge {
      background: rgba(79,209,197,0.15);
      border: 1px solid rgba(79,209,197,0.3);
      color: #4fd1c5;
      font-size: 11px; font-weight: 600;
      padding: 5px 14px;
      border-radius: 999px;
      letter-spacing: 0.03em;
    }
    .report-title { color: #ffffff; font-size: 24px; font-weight: 900; line-height: 1.25; }
    .report-meta  { color: rgba(255,255,255,0.45); font-size: 11px; margin-top: 7px; line-height: 1.6; }
    .report-meta strong { color: rgba(255,255,255,0.8); font-weight: 600; }

    /* ── KPI strip ── */
    .kpi-strip {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      border-bottom: 1px solid #e2e8f0;
    }
    .kpi-card {
      padding: 20px 22px;
      border-right: 1px solid #e2e8f0;
    }
    .kpi-card:last-child { border-right: none; }
    .kpi-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; margin-bottom: 6px; }
    .kpi-value { font-size: 19px; font-weight: 900; color: #0f172a; }
    .kpi-value.green { color: #10b981; }
    .kpi-value.red   { color: #f43f5e; }
    .kpi-note { font-size: 10px; color: #94a3b8; margin-top: 3px; }

    /* ── Net band ── */
    .net-band {
      background: #f0fdf4;
      border-bottom: 1px solid #bbf7d0;
      padding: 12px 28px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .net-band.loss { background: #fff1f2; border-color: #fecdd3; }
    .net-label { font-size: 12px; font-weight: 600; color: #64748b; }
    .net-value { font-size: 15px; font-weight: 900; }

    /* ── Section ── */
    .section { padding: 26px 28px 0; }
    .section + .section { padding-top: 22px; }
    .section-title {
      font-size: 12px; font-weight: 800;
      color: #0f172a;
      text-transform: uppercase; letter-spacing: 0.07em;
      padding-bottom: 10px;
      border-bottom: 2px solid #e2e8f0;
      margin-bottom: 0;
    }
    /* ── Table ── */
    table { width: 100%; border-collapse: collapse; }
    thead th {
      padding: 9px 12px;
      text-align: left;
      font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.06em;
      color: #94a3b8;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
    }
    thead th:last-child, thead th.r { text-align: right; }
    tbody tr { border-bottom: 1px solid #f1f5f9; }
    tbody tr:last-child { border-bottom: none; }

    /* ── Debt / cost totals ── */
    .total-row {
      padding: 13px 28px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .total-row.amber { background: #fffbeb; border-top: 2px solid #fde68a; }
    .total-row.red   { background: #fff1f2; border-top: 2px solid #fecdd3; }
    .total-label { font-size: 13px; font-weight: 700; color: #475569; }
    .total-value { font-size: 16px; font-weight: 900; }

    /* ── Margin pill ── */
    .margin-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 10px 20px;
      border-radius: 12px;
      margin: 14px 28px;
      font-size: 13px; font-weight: 700;
    }

    /* ── Footer ── */
    .footer {
      margin-top: 36px;
      padding: 22px 28px;
      background: #071514;
      display: flex; align-items: center; justify-content: space-between;
    }
    .footer-brand { display: flex; align-items: center; gap: 10px; }
    .footer-logo {
      width: 30px; height: 30px; background: #4fd1c5; border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 15px; font-weight: 900; color: #071514;
    }
    .footer-name { color: #fff; font-size: 12px; font-weight: 800; letter-spacing: 0.15em; }
    .footer-sub  { color: rgba(255,255,255,0.35); font-size: 10px; margin-top: 2px; }
    .footer-gen  { color: rgba(255,255,255,0.3); font-size: 10px; text-align: right; line-height: 1.5; }

    /* ── Print ── */
    @media print {
      body { background: white; }
      .page { box-shadow: none; margin: 0; max-width: none; }
      .section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="header-top">
      <div class="logo">
        <div class="logo-icon">Z</div>
        <div>
          <div class="logo-name">ZURIA</div>
          <div class="logo-sub">${planLabel}</div>
        </div>
      </div>
      <div class="plan-badge">${planLabel}</div>
    </div>
    <div class="report-title">${d.reportLabel}</div>
    <div class="report-meta">
      <strong>${d.businessName}</strong> &nbsp;·&nbsp; Owner: <strong>${d.ownerName}</strong>
      &nbsp;·&nbsp; Generated: ${d.generatedAt}
    </div>
  </div>

  <!-- KPI strip -->
  <div class="kpi-strip">
    <div class="kpi-card">
      <div class="kpi-label">Revenue</div>
      <div class="kpi-value green">${fmt(d.revenue)}</div>
      <div class="kpi-note">Sales &amp; repayments</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Costs</div>
      <div class="kpi-value red">${fmt(d.costs)}</div>
      <div class="kpi-note">Expenses, salaries, etc.</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">${d.profit >= 0 ? "Net Profit" : "Net Loss"}</div>
      <div class="kpi-value" style="color:${profitColor};">${profitSign}${fmt(Math.abs(d.profit))}</div>
      <div class="kpi-note">Revenue minus costs</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Margin</div>
      <div class="kpi-value" style="color:${healthColor};">${marginPct}%</div>
      <div class="kpi-note" style="color:${healthColor};">${healthLabel}</div>
    </div>
  </div>

  <!-- Net cash band -->
  <div class="net-band ${d.netCash < 0 ? "loss" : ""}">
    <span class="net-label">Cash in: <strong style="color:#0f172a;">${fmt(d.moneyIn)}</strong> &nbsp;|&nbsp; Cash out: <strong style="color:#0f172a;">${fmt(d.moneyOut)}</strong></span>
    <span class="net-value" style="color:${d.netCash >= 0 ? "#10b981" : "#f43f5e"};">
      Net ${d.netCash >= 0 ? "+" : "−"}${fmt(Math.abs(d.netCash))}
    </span>
  </div>

  <!-- Daily breakdown (weekly reports only) -->
  ${d.reportType === "weekly" && d.dailyBreakdown.length > 0 ? `
  <div class="section" style="margin-top:22px;">
    <div class="section-title">Daily Breakdown</div>
    <table>
      <thead>
        <tr>
          <th>Day</th>
          <th class="r">Revenue</th>
          <th class="r">Costs</th>
          <th class="r">Net</th>
        </tr>
      </thead>
      <tbody>${dailyRows}</tbody>
    </table>
  </div>
  ` : ""}

  <!-- Cost breakdown (monthly reports only) -->
  ${d.reportType === "monthly" && Object.keys(d.costBreakdown).length > 1 ? `
  <div class="section" style="margin-top:22px;">
    <div class="section-title">Cost Breakdown</div>
    <table>
      <thead>
        <tr>
          <th>Category</th>
          <th class="r">Amount</th>
          <th class="r">% of Costs</th>
        </tr>
      </thead>
      <tbody>${costRows}</tbody>
    </table>
  </div>
  <div class="total-row red">
    <span class="total-label">Total operating costs</span>
    <span class="total-value" style="color:#f43f5e;">${fmt(d.costs)}</span>
  </div>
  ` : ""}

  <!-- Transactions -->
  ${d.txns.length > 0 ? `
  <div class="section" style="margin-top:22px;">
    <div class="section-title">Transactions (${d.txns.length}${d.txns.length >= 60 ? " — showing most recent 60" : ""})</div>
    <table>
      <thead>
        <tr>
          <th style="width:72px;">Date</th>
          <th>Description</th>
          <th style="width:130px;">Type</th>
          <th style="width:120px;" class="r">Amount</th>
        </tr>
      </thead>
      <tbody>${txRows}</tbody>
    </table>
  </div>
  ` : `
  <div class="section" style="margin-top:22px;padding-bottom:20px;">
    <div class="section-title">Transactions</div>
    <p style="color:#94a3b8;font-size:13px;padding:20px 0;">No transactions recorded in this period.</p>
  </div>
  `}

  <!-- Outstanding debts -->
  ${d.debts.length > 0 ? `
  <div class="section" style="margin-top:22px;">
    <div class="section-title">Outstanding Customer Debts (${d.debts.length})</div>
    <table>
      <thead>
        <tr>
          <th>Customer</th>
          <th class="r">Amount Owed</th>
        </tr>
      </thead>
      <tbody>${debtRows}</tbody>
    </table>
  </div>
  <div class="total-row amber">
    <span class="total-label" style="color:#92400e;">Total receivable from customers</span>
    <span class="total-value" style="color:#d97706;">${fmt(d.totalDebt)}</span>
  </div>
  ` : ""}

  <!-- Spacer -->
  <div style="height:32px;"></div>

  <!-- Footer -->
  <div class="footer">
    <div class="footer-brand">
      <div class="footer-logo">Z</div>
      <div>
        <div class="footer-name">ZURIA</div>
        <div class="footer-sub">The AI memory system for African businesses</div>
      </div>
    </div>
    <div class="footer-gen">
      ${planLabel} Report<br />
      ${d.generatedAt}<br />
      <span style="color:rgba(255,255,255,0.2);">Confidential — for ${d.ownerName} only</span>
    </div>
  </div>

</div>
<script>
  window.addEventListener('load', function () {
    // Small delay so fonts finish rendering before print dialog opens
    setTimeout(function () { window.print(); }, 800);
  });
</script>
</body>
</html>`;
}
