"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Home, RefreshCw } from "lucide-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[App Error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-rose-500/15">
        <span className="text-3xl">😕</span>
      </div>
      <div>
        <h1 className="text-2xl font-black">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Don&apos;t worry — your records are safe. Try refreshing.
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 active:scale-95"
        >
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-2xl border border-white/10 px-5 py-3 text-sm font-bold transition hover:bg-white/5 active:scale-95"
        >
          <Home className="h-4 w-4" /> Dashboard
        </Link>
      </div>
    </div>
  );
}
