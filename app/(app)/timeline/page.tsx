"use client";

/**
 * /timeline — Business Timeline page.
 *
 * Shows the full chronological operational story of the business.
 * Events are generated server-side (stored in Firestore `business_timeline`)
 * and fetched from /api/intelligence/timeline.
 *
 * Filter tabs: All | Revenue | Stock | Debts | Expenses
 */

import { useEffect, useState, useCallback } from "react";
import { Clock, RefreshCw } from "lucide-react";
import {
  BusinessTimeline,
  BusinessTimelineSkeleton,
} from "@/components/dashboard/business-timeline";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/app-store";
import type { TimelineEvent } from "@/lib/timeline";
import { cn } from "@/lib/utils";

type FilterTab = "all" | "revenue" | "stock" | "debts" | "expenses";

const TABS: { key: FilterTab; label: string; emoji: string }[] = [
  { key: "all",      label: "All",      emoji: "📋" },
  { key: "revenue",  label: "Revenue",  emoji: "💰" },
  { key: "stock",    label: "Stock",    emoji: "📦" },
  { key: "debts",    label: "Debts",    emoji: "🤝" },
  { key: "expenses", label: "Expenses", emoji: "💸" },
];

const FILTER_TYPES: Record<FilterTab, string[]> = {
  all: [],
  revenue: ["revenue_milestone", "revenue_decline", "business_anniversary", "business_milestone"],
  stock: ["inventory_restock", "inventory_low", "stock_forecast_warning", "supplier_price_change"],
  debts: ["debt_created", "debt_cleared", "debt_milestone", "debt_recovery_milestone", "payment_behavior_alert", "customer_loyalty_milestone"],
  expenses: ["expense_spike", "expense_category_spike", "cash_warning"],
};

export default function TimelinePage() {
  const business = useAppStore((s) => s.business);
  const user     = useAppStore((s) => s.user);

  const [events, setEvents]   = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [tab, setTab]         = useState<FilterTab>("all");
  const [days, setDays]       = useState(30);

  const fetchTimeline = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/intelligence/timeline?businessId=${business.id}&days=${days}`,
      );
      if (!res.ok) throw new Error(await res.text());
      const data: TimelineEvent[] = await res.json();
      setEvents(data);
    } catch (err) {
      setError("Couldn't load timeline. Please try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [business?.id, days]);

  useEffect(() => {
    void fetchTimeline();
  }, [fetchTimeline]);

  // Filter events by active tab
  const filtered =
    tab === "all"
      ? events
      : events.filter((e) =>
          FILTER_TYPES[tab].includes(e.type),
        );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-primary">Your business story</p>
          <h1 className="mt-1 text-3xl font-black">Timeline</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Significant events in your business, in order.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => void fetchTimeline()}
          disabled={loading}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors",
              tab === t.key
                ? "bg-primary text-primary-foreground"
                : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
            )}
          >
            <span>{t.emoji}</span>
            {t.label}
            {tab === t.key && t.key !== "all" && (
              <span className="ml-1 rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px]">
                {FILTER_TYPES[t.key].reduce(
                  (s, type) =>
                    s + events.filter((e) => e.type === type).length,
                  0,
                )}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Window selector */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        <span>Showing</span>
        {[7, 14, 30, 60, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={cn(
              "rounded-lg px-2 py-1 transition-colors",
              days === d
                ? "bg-primary/15 text-primary font-semibold"
                : "hover:bg-white/[0.05]",
            )}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <BusinessTimelineSkeleton />
      ) : error ? (
        <div className="rounded-2xl bg-rose-500/10 p-4 text-sm text-rose-400">
          {error}
        </div>
      ) : (
        <BusinessTimeline events={filtered} />
      )}
    </div>
  );
}
