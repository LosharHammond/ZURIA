"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  variant?: "default" | "positive" | "negative" | "warning" | "neutral";
  delay?: number;
}

const variantStyles = {
  default: { icon: "bg-primary/15 text-primary", value: "" },
  positive: { icon: "bg-emerald-500/15 text-emerald-400", value: "text-emerald-400" },
  negative: { icon: "bg-rose-500/15 text-rose-400", value: "text-rose-400" },
  warning: { icon: "bg-amber-500/15 text-amber-400", value: "text-amber-400" },
  neutral: { icon: "bg-sky-500/15 text-sky-400", value: "text-sky-400" },
};

export function MetricCard({ title, value, detail, icon: Icon, variant = "default", delay = 0 }: MetricCardProps) {
  const styles = variantStyles[variant];

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className={cn("mt-2 text-2xl font-black truncate", styles.value)}>{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
          </div>
          <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", styles.icon)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
