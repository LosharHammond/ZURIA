import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "danger";

const variantClass: Record<BadgeVariant, string> = {
  default: "border-white/10 bg-white/10 text-muted-foreground",
  secondary: "border-secondary/30 bg-secondary/15 text-secondary",
  outline: "border-white/20 bg-transparent text-muted-foreground",
  success: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400",
  warning: "border-amber-500/30 bg-amber-500/15 text-amber-400",
  danger: "border-rose-500/30 bg-rose-500/15 text-rose-400",
};

export function Badge({
  className,
  children,
  variant = "default",
}: {
  className?: string;
  children: React.ReactNode;
  variant?: BadgeVariant;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
        variantClass[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
