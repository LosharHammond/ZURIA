import { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

export function EmptyState({ icon: Icon, title, message }: { icon: LucideIcon; title: string; message: string }) {
  return (
    <Card className="flex min-h-44 flex-col items-center justify-center text-center">
      <Icon className="mb-3 h-8 w-8 text-primary" />
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{message}</p>
    </Card>
  );
}
