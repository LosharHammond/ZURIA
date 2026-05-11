"use client";

import { Bell } from "lucide-react";
import type { SmartNotification } from "@/types/domain";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

export function NotificationList({ notifications }: { notifications: SmartNotification[] }) {
  if (!notifications.length) return <EmptyState icon={Bell} title="All good for now" message="ZURIA will send you messages when something in your business needs attention." />;
  return (
    <div className="space-y-3">
      {notifications.map((notification) => (
        <Card key={notification.id} className={cn(notification.severity === "warning" && "border-secondary/30 bg-secondary/10", notification.severity === "success" && "border-primary/30 bg-primary/10")}>
          <p className="font-bold">{notification.title}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{notification.message}</p>
        </Card>
      ))}
    </div>
  );
}
