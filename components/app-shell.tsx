"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Boxes, Gift, HandCoins, Home, PlusCircle, UserCircle, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

const nav = [
  { href: "/dashboard", label: "Home",    icon: Home        },
  { href: "/transactions", label: "Record", icon: PlusCircle  },
  { href: "/debts",        label: "Debts",  icon: HandCoins   },
  { href: "/inventory",    label: "Stock",  icon: Boxes       },
  { href: "/referrals",    label: "Earn",   icon: Gift        },
  { href: "/profile",      label: "Me",     icon: UserCircle  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { business, offline, setOffline } = useAppStore();

  useEffect(() => {
    setOffline(!navigator.onLine);
    const onOnline  = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online",  onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [setOffline]);

  return (
    <div className="min-h-screen pb-28 md:pb-0">
      {/* ── Top header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-3">
            {/* ZURIA icon from public/icon.svg — inlined for instant render */}
            <svg width="40" height="40" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0 rounded-[12px]">
              <rect width="96" height="96" rx="24" fill="#071514"/>
              <path d="M25 65L58 31H30V21H74V31L41 65H72V75H25V65Z" fill="#4FD1C5"/>
              <circle cx="25" cy="24" r="6" fill="#F59E0B"/>
            </svg>
            <div>
              <span className="block text-sm font-bold tracking-[0.2em]">ZURIA</span>
              <span className="block text-xs text-muted-foreground leading-none">{business?.name ?? "Business memory"}</span>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            {offline && (
              <span className="flex items-center gap-1.5 rounded-full bg-secondary/15 px-3 py-1.5 text-xs text-secondary">
                <WifiOff className="h-3.5 w-3.5" /> Offline
              </span>
            )}
            <Link href="/notifications" className="relative rounded-full p-2 hover:bg-white/5">
              <Bell className="h-5 w-5 text-muted-foreground" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>

      {/* ── Bottom nav ─────────────────────────────────────────────────────── */}
      <nav className="fixed inset-x-2 bottom-2 z-40 rounded-[1.75rem] border border-white/10 bg-[#071514]/95 px-2 py-2 shadow-2xl backdrop-blur-xl md:left-1/2 md:w-[600px] md:-translate-x-1/2">
        <div className="grid grid-cols-6 gap-0.5">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-2xl px-1 py-2.5 text-[10px] font-medium text-muted-foreground transition-all",
                  active && "bg-primary text-primary-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
