import { GlassCard } from "@/components/ui/card";
import type { DailySummary } from "@/types/domain";
import { formatMoney } from "@/lib/utils";

export function DailySummaryCard({ summary, ownerName }: { summary: DailySummary; ownerName?: string }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <GlassCard>
      <p className="text-sm font-semibold text-secondary">{greeting}, {ownerName ?? "boss"} 👋</p>
      <h2 className="mt-2 text-xl font-black">How today went</h2>

      <div className="mt-5 grid gap-3">
        <Row label="Money you received" value={formatMoney(summary.moneyIn)} positive />
        <Row label="Money you spent" value={formatMoney(summary.moneyOut)} />
        <Row label="What you made today" value={formatMoney(summary.estimatedProfit)} positive={summary.estimatedProfit >= 0} />
      </div>

      {(summary.salesRevenue > 0 || summary.operatingCosts > 0) && (
        <div className="mt-4 grid gap-2 border-t border-white/10 pt-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">More details</p>
          {summary.salesRevenue > 0 && <SmallRow label="From selling" value={formatMoney(summary.salesRevenue)} />}
          {summary.operatingCosts > 0 && <SmallRow label="Running costs" value={formatMoney(summary.operatingCosts)} />}
          {summary.borrowingsIn > 0 && <SmallRow label="Money you borrowed" value={formatMoney(summary.borrowingsIn)} />}
          {summary.lendingsOut > 0 && <SmallRow label="Money you gave out" value={formatMoney(summary.lendingsOut)} />}
        </div>
      )}

      {summary.topProduct && (
        <p className="mt-4 text-sm text-muted-foreground">
          Best seller today: <span className="text-foreground font-semibold">{summary.topProduct}</span>
        </p>
      )}

      {summary.warning && (
        <p className="mt-3 rounded-2xl bg-secondary/15 p-3 text-sm text-secondary">{summary.warning}</p>
      )}
    </GlassCard>
  );
}

function Row({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-white/[0.06] px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`font-bold ${positive === true ? "text-emerald-400" : positive === false ? "text-rose-400" : ""}`}>{value}</span>
    </div>
  );
}

function SmallRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold">{value}</span>
    </div>
  );
}
