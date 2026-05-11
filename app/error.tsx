"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[Root Error]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-rose-500/15">
        <span className="text-3xl">😕</span>
      </div>
      <div>
        <h1 className="text-2xl font-black">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Don&apos;t worry — your data is safe. Try refreshing the page.
        </p>
      </div>
      <button
        onClick={reset}
        className="flex items-center gap-2 rounded-2xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 active:scale-95"
      >
        <RefreshCw className="h-4 w-4" /> Try again
      </button>
    </div>
  );
}
