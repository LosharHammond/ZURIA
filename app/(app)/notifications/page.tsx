"use client";

import { NotificationList } from "@/components/notifications/notification-list";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useBusinessData } from "@/hooks/use-business-data";

export default function NotificationsPage() {
  const { notifications, loading } = useBusinessData();

  if (loading) return <PageSkeleton rows={3} />;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-accent">Things to know</p>
        <h1 className="mt-1 text-3xl font-black">Notices for You</h1>
      </div>
      <NotificationList notifications={notifications} />
    </div>
  );
}
