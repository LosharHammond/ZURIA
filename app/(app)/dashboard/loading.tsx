import { DashboardSkeleton } from "@/components/ui/skeleton";

// Next.js automatically renders this during page-level data fetching
// and on client-side navigation to /dashboard while the page JS loads.
export default function DashboardLoading() {
  return <DashboardSkeleton />;
}
