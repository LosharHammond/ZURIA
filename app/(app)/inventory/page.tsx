"use client";

import { InventoryList } from "@/components/inventory/inventory-list";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useBusinessData } from "@/hooks/use-business-data";

export default function InventoryPage() {
  const { inventory, loading } = useBusinessData();

  if (loading) return <PageSkeleton rows={4} />;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-primary">Know what you have</p>
        <h1 className="mt-1 text-3xl font-black">Your Stock</h1>
      </div>
      <InventoryList inventory={inventory} />
    </div>
  );
}
