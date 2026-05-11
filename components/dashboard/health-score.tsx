"use client";

import { HeartPulse } from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export function HealthScore({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  const label = clamped >= 76 ? "Very good! Keep it up 🌟" : clamped >= 55 ? "Okay — watch your costs" : "Needs your attention ⚠️";
  return (
    <GlassCard>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">How your business is doing</p>
          <p className="mt-1 text-3xl font-black">{clamped}/100</p>
        </div>
        <HeartPulse className="h-8 w-8 text-accent" />
      </div>
      <Progress value={clamped} className="mt-5" />
      <p className="mt-3 text-sm text-muted-foreground">{label}</p>
    </GlassCard>
  );
}
