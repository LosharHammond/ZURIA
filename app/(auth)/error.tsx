"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle, RefreshCw } from "lucide-react";

const SUPPORT_WA =
  `https://wa.me/${
    (process.env.NEXT_PUBLIC_ADMIN_MOMO ?? process.env.NEXT_PUBLIC_ADMIN_PHONE ?? "0242176603")
      .replace(/^0/, "233").replace(/^\+/, "")
  }`;

function getAuthErrorHint(message: string): string {
  if (/network|fetch|failed to fetch/i.test(message))
    return "Check your internet connection and try again.";
  if (/token|expired|invalid/i.test(message))
    return "Your session may have expired. Try signing in again.";
  if (/too many|rate/i.test(message))
    return "Too many attempts. Wait a few minutes and try again.";
  if (/phone|number/i.test(message))
    return "Check your phone number and try again.";
  return "There was a problem signing in. Please try again.";
}

export default function AuthError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Structured log — captured by hosting platform log drains
    console.error(JSON.stringify({
      context: "[Auth Error]",
      message: error.message,
      digest: error.digest,
      ts: new Date().toISOString(),
    }));
  }, [error]);

  function copyError() {
    const info = `Auth error\nMessage: ${error.message}\nDigest: ${error.digest ?? "n/a"}`;
    navigator.clipboard.writeText(info).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const hint = getAuthErrorHint(error.message);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-rose-500/15">
        <span className="text-3xl">😕</span>
      </div>

      <div className="max-w-sm">
        <h1 className="text-2xl font-black">Sign-in problem</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-6">{hint}</p>

        {error.digest && (
          <button
            onClick={copyError}
            className="mt-2 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            {copied ? "Copied!" : `Error ref: ${error.digest}`}
          </button>
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        <button
          onClick={reset}
          className="flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 active:scale-95"
        >
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
        <Link
          href="/"
          className="flex items-center gap-2 rounded-2xl border border-white/10 px-5 py-3 text-sm font-bold transition hover:bg-white/5 active:scale-95"
        >
          Go home
        </Link>
        <a
          href={SUPPORT_WA}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-2xl border border-white/10 px-5 py-3 text-sm font-bold transition hover:bg-white/5 active:scale-95"
        >
          <MessageCircle className="h-4 w-4" /> Get help
        </a>
      </div>
    </main>
  );
}
