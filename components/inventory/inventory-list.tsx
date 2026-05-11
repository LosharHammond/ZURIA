"use client";

import { Boxes } from "lucide-react";
import type { InventoryItem } from "@/types/domain";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export function InventoryList({ inventory }: { inventory: InventoryItem[] }) {
  if (!inventory.length) return <EmptyState icon={Boxes} title="No stock recorded yet" message='When you record buying goods with a number (e.g. "Bought rice 20 bags"), ZURIA will watch for low stock.' />;
  const sorted = [...inventory].sort((a, b) => {
    const aLow = a.quantity !== null && a.quantity <= a.lowStockThreshold;
    const bLow = b.quantity !== null && b.quantity <= b.lowStockThreshold;
    if (aLow && !bLow) return -1;
    if (!aLow && bLow) return 1;
    return (a.productName ?? "").localeCompare(b.productName ?? "");
  });
  return (
    <div className="space-y-3">
      {sorted.map((item) => {
        const low = item.quantity !== null && item.quantity <= item.lowStockThreshold;
        const qtyDisplay = item.quantity === null ? "—" : item.quantity;
        return (
          <Card key={item.id} className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-bold">{item.productName}</h3>
              <p className="mt-1 text-sm text-muted-foreground">Alert when below: {item.lowStockThreshold}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black">{qtyDisplay}</p>
              {low ? (
                <Badge variant="secondary">Running low!</Badge>
              ) : (
                <Badge variant="outline">Enough stock</Badge>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
