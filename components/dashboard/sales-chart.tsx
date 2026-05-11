"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import type { ChartPoint } from "@/types/domain";
import { formatMoney } from "@/lib/utils";

export function SalesChart({ data }: { data: ChartPoint[] }) {
  const hasNet = data.some((d) => d.net !== undefined);
  const hasBorrowings = data.some((d) => d.borrowings > 0);

  return (
    <Card>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="font-bold">7-day cash flow</h2>
          <p className="text-sm text-muted-foreground">Money in, money out, and net position.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-full bg-emerald-400" />Sales</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-full bg-amber-400" />Costs</span>
          {hasNet && <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-full bg-sky-400" />Net</span>}
          {hasBorrowings && <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-full bg-violet-400" />Loans</span>}
        </div>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="gradSales" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor="#34d399" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradExpenses" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradNet" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradBorr" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" stroke="rgba(255,255,255,.4)" axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip
              contentStyle={{ background: "#0c1b1a", border: "1px solid rgba(255,255,255,.12)", borderRadius: 16 }}
              formatter={(value: number, name: string) => [formatMoney(value), name === "net" ? "Net" : name.charAt(0).toUpperCase() + name.slice(1)]}
            />
            <Area type="monotone" dataKey="sales" stroke="#34d399" fill="url(#gradSales)" strokeWidth={2.5} />
            <Area type="monotone" dataKey="expenses" stroke="#f59e0b" fill="url(#gradExpenses)" strokeWidth={2.5} />
            {hasNet && <Area type="monotone" dataKey="net" stroke="#38bdf8" fill="url(#gradNet)" strokeWidth={2} />}
            {hasBorrowings && <Area type="monotone" dataKey="borrowings" stroke="#a78bfa" fill="url(#gradBorr)" strokeWidth={2} />}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
