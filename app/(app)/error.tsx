"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Home, MessageCircle, RefreshCw } from "lucide-react";

const SUPPORT_WA =
  `https://wa.me/${
    (process.env.NEXT_PUBLIC_ADMIN_MOMO ?? process.env.NEXT_PUBLIC_ADMIN_PHONE ?? "0242176603")
      .replace(/^0/, "233").replace(/^\+/, "")
  }`;

function getAppErrorHint(message: string): { title: string; body: string } {
  if (/network|fetch|failed to fetch|offline/i.test(message))
    return { title: "Connection issue", body: "Check your internet and try again. Your records are safe and will sync when you reconnect." };
  if (/permission|auth|unauthorized|forbidden/i.test(message))
    return { title: "Session expired", body: "Your session may have expired. Go to dashboard to sign in again — all your records are safe." };
  if (/quota|limit/i.test(message))
    return { title: "Usage limit reached", body: "You've reached your plan limit. Upgrade to continue recording — or wait until tomorrow." };
  return { title: "Something went wrong", body: "Don’t worry — your records are safe. Try refreshing the page." };
}

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    console.error(JSON.stringify({
      context: "[App Error]",
      message: error.message,
      digest: error.digest,
      ts: new Date().toISOString(),
    }));
  }, [error]);

  function copyError() {
    const info = `App error\nMessage: ${error.message}\nDigest: ${error.digest ?? "n/a"}\nURL: ${window.location.href}`;
    navigator.clipboard.writeText(info).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const { title, body } = getAppErrorHint(error.message);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-rose-500/15">
        <span className="text-3xl">😕</span>
      </div>

      <div className="max-w-sm">
        <h1 className="text-2xl font-black">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-6">{body}</p>
        {error.digest && (
          <button
            onClick={copyError}
            className="mt-2 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            {copied ? "Copied!" : `Ref: ${error.digest}`}
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
          href="/dashboard"
          className="flex items-center gap-2 rounded-2xl border border-white/10 px-5 py-3 text-sm font-bold transition hover:bg-white/5 active:scale-95"
        >
          <Home className="h-4 w-4" /> Dashboard
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
    </div>
  );
}
