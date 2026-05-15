"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell, Boxes, CrownIcon, Gift, HandCoins,
  Home, PlusCircle, UserCircle, WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { ServiceBanner } from "@/components/ui/service-banner";

const NAV_ITEMS = [
  { href: "/dashboard",    label: "Home",         icon: Home        },
  { href: "/transactions", label: "Record",        icon: PlusCircle  },
  { href: "/debts",        label: "Debts",         icon: HandCoins   },
  { href: "/inventory",    label: "Stock",         icon: Boxes       },
  { href: "/referrals",    label: "Refer & Earn",  icon: Gift        },
  { href: "/subscription", label: "Plan",          icon: CrownIcon   },
  { href: "/profile",      label: "Profile",       icon: UserCircle  },
  { href: "/notifications",label: "Notifications", icon: Bell        },
];

// Bottom nav items for mobile (max 5)
const BOTTOM_NAV_ITEMS = [
  { href: "/dashboard",    label: "Home",    icon: Home        },
  { href: "/transactions", label: "Record",  icon: PlusCircle  },
  { href: "/debts",        label: "Debts",   icon: HandCoins   },
  { href: "/inventory",    label: "Stock",   icon: Boxes       },
  { href: "/profile",      label: "Profile", icon: UserCircle  },
];

// ── ZURIA wordmark SVG ────────────────────────────────────────────────────────
function ZuriaLogo({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0 rounded-[10px]"
    >
      <rect width="96" height="96" rx="24" fill="#071514" />
      <path d="M25 65L58 31H30V21H74V31L41 65H72V75H25V65Z" fill="#4FD1C5" />
      <circle cx="25" cy="24" r="6" fill="#F59E0B" />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // SyncProvider (mounted above in the tree) already manages the online/offline
  // listeners and updates the store. We only read from the store here.
  const business = useAppStore((s) => s.business);
  const offline = useAppStore((s) => s.offline);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1">

      {/* ── Left sidebar — hidden on mobile, visible on sm+ ───────────────── */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden sm:flex w-14 flex-col border-r border-white/10 bg-[#071514]/95 backdrop-blur-xl md:w-56">

        {/* Logo / brand */}
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-3">
          <Link href="/dashboard" className="flex items-center gap-3 min-w-0">
            <ZuriaLogo size={36} />
            <div className="hidden md:block min-w-0">
              <span className="block text-sm font-bold tracking-[0.18em]">ZURIA</span>
              <span className="block truncate text-[11px] text-muted-foreground leading-none">
                {business?.name ?? "Business memory"}
              </span>
            </div>
          </Link>
        </div>

        {/* Nav links */}
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm font-medium transition-all",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="hidden md:block leading-none">{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Offline badge at bottom */}
        {offline && (
          <div className="shrink-0 border-t border-white/10 px-3 py-3">
            <span className="flex items-center gap-1.5 rounded-xl bg-secondary/15 px-2 py-1.5 text-xs text-secondary">
              <WifiOff className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden md:block">Offline</span>
            </span>
          </div>
        )}
      </aside>

      {/* ── Main content area ─────────────────────────────────────────────── */}
      {/* No left padding on mobile (sidebar hidden), sm:pl-14, md:pl-56     */}
      <div className="flex min-h-screen flex-1 flex-col sm:pl-14 md:pl-56">
        {/* Banner lives INSIDE the padded column so the fixed sidebar never covers it */}
        <ServiceBanner />
        <main className="flex-1 px-4 py-5 md:px-6 md:py-7">
          {/* pb-20 on mobile so content isn't obscured by bottom nav */}
          <div className="mx-auto max-w-3xl pb-20 sm:pb-0">
            {children}
          </div>
        </main>
      </div>

      </div>{/* end flex row */}

      {/* ── Mobile bottom navigation — sm:hidden ──────────────────────────── */}
      <nav
        aria-label="Mobile navigation"
        className="fixed bottom-0 left-0 right-0 z-50 sm:hidden border-t border-white/10 bg-[#071514]/80 backdrop-blur-xl"
      >
        <div className="flex items-stretch">
          {BOTTOM_NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            const isRecord = href === "/transactions";
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                {/* Record tab gets a pill accent */}
                {isRecord ? (
                  <span
                    className={cn(
                      "flex items-center justify-center rounded-full p-2.5 transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-primary/20 text-primary"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                ) : (
                  <span className="relative flex items-center justify-center">
                    <Icon className="h-5 w-5" />
                    {/* Active dot indicator */}
                    {active && (
                      <span className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary" />
                    )}
                  </span>
                )}
                <span className={cn("text-[10px] font-medium leading-none", isRecord && !active && "text-primary")}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
        {/* Safe area spacer for phones with home indicator */}
        <div className="h-safe-area-inset-bottom" style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
      </nav>
    </div>
  );
}
