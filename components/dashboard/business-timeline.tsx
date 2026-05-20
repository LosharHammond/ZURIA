"use client";

/**
 * BusinessTimeline — chronological operational intelligence feed.
 *
 * Renders a vertical timeline of significant business events: revenue
 * milestones, debt activity, stock restocks, expense anomalies,
 * supplier price changes, customer loyalty events, and anniversaries.
 *
 * Design:
 *   - Vertical connector line with icon nodes
 *   - Severity-coded colors: positive=emerald, warning=amber, critical=rose, neutral=sky
 *   - Progressive fade-in on mount (CSS animation, no framer-motion)
 *   - Empty state with encouragement
 *   - Skeleton loading state
 */

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { TimelineEvent } from "@/lib/timeline";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Severity style map ───────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<
  TimelineEvent["severity"],
  { dot: string; text: string; bg: string; border: string }
> = {
  positive: {
    dot:    "bg-emerald-500",
    text:   "text-emerald-400",
    bg:     "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  neutral: {
    dot:    "bg-sky-500",
    text:   "text-sky-400",
    bg:     "bg-sky-500/10",
    border: "border-sky-500/20",
  },
  warning: {
    dot:    "bg-amber-500",
    text:   "text-amber-400",
    bg:     "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  critical: {
    dot:    "bg-rose-500",
    text:   "text-rose-400",
    bg:     "bg-rose-500/10",
    border: "border-rose-500/20",
  },
};

// ─── Single event card ────────────────────────────────────────────────────────

interface EventCardProps {
  event: TimelineEvent;
  isLast: boolean;
}

const EventCard = memo(function EventCard({ event, isLast }: EventCardProps) {
  const styles = SEVERITY_STYLES[event.severity];
  const date = new Date(event.occurredAt);
  const dateLabel = date.toLocaleDateString("en-GH", {
    day:   "numeric",
    month: "short",
    year:  "numeric",
  });
  const timeLabel = date.toLocaleTimeString("en-GH", {
    hour:   "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  return (
    <div className="flex gap-4">
      {/* Connector + dot */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base",
            styles.bg,
            "border",
            styles.border,
          )}
        >
          {event.icon}
        </div>
        {!isLast && (
          <div className="mt-1 w-px flex-1 bg-white/[0.07]" />
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          "mb-4 flex-1 rounded-2xl border px-4 py-3",
          "bg-white/[0.03]",
          styles.border,
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold leading-tight">{event.title}</p>
          <span
            className={cn(
              "shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              styles.bg,
              styles.text,
            )}
          >
            {event.severity}
          </span>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {event.description}
        </p>
        {event.metric !== undefined && (
          <p className={cn("mt-1.5 text-sm font-black", styles.text)}>
            GH₵{event.metric.toFixed(2)}
          </p>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground/60">
          {dateLabel} · {timeLabel}
        </p>
      </div>
    </div>
  );
});

// ─── Skeleton loader ──────────────────────────────────────────────────────────

export function BusinessTimelineSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <div className="flex flex-col items-center">
            <Skeleton className="h-9 w-9 rounded-xl" />
            {i < 3 && <div className="mt-1 w-px flex-1 bg-white/[0.07]" style={{ minHeight: 64 }} />}
          </div>
          <div className="mb-4 flex-1">
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface BusinessTimelineProps {
  events: TimelineEvent[];
  className?: string;
  /** If true, shows a "View all" button placeholder at the bottom */
  showViewAll?: boolean;
  onViewAll?: () => void;
}

export const BusinessTimeline = memo(function BusinessTimeline({
  events,
  className,
  showViewAll,
  onViewAll,
}: BusinessTimelineProps) {
  if (events.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center py-12 text-center",
          className,
        )}
      >
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.05] text-2xl">
          📖
        </div>
        <p className="text-sm font-semibold">No events yet</p>
        <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
          As you record sales, expenses, and debts, ZURIA will build your
          business story here.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("animate-in fade-in duration-500", className)}>
      {events.map((event, idx) => (
        <EventCard
          key={event.id}
          event={event}
          isLast={idx === events.length - 1 && !showViewAll}
        />
      ))}

      {showViewAll && (
        <button
          onClick={onViewAll}
          className="mt-1 w-full rounded-2xl border border-white/10 py-3 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
        >
          View full timeline →
        </button>
      )}
    </div>
  );
});
