"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Copy, Send, WifiOff } from "lucide-react";

const TELEGRAM_BOT     = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "ZuriaBot";
const SANDBOX_NUMBER   = "+14155238886";
const SANDBOX_CODE     = "join contrast-pull";
const SANDBOX_LINK     = `https://wa.me/14155238886?text=${encodeURIComponent(SANDBOX_CODE)}`;

/**
 * Global service-status banner.
 * Shows at the very top of every page while WhatsApp Business API is suspended.
 * Includes Twilio sandbox join instructions and Telegram as a full alternative.
 */
export function ServiceBanner() {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied]     = useState<string | null>(null);

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <div className="w-full border-b border-amber-500/25 bg-amber-500/10">
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-6xl px-4 py-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Status notice */}
          <div className="flex items-center gap-2 text-xs text-amber-300">
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
            <span>
              <strong>WhatsApp Business API is temporarily down.</strong>{" "}
              Use the{" "}
              <button
                onClick={() => setExpanded((v) => !v)}
                className="underline underline-offset-2 hover:text-amber-200 transition-colors"
              >
                WhatsApp Sandbox
              </button>{" "}
              or Telegram while we fix it.
            </span>
          </div>

          {/* CTAs */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-3 py-1 text-[11px] font-bold text-amber-300 hover:bg-amber-500/25 transition-colors"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? "Hide" : "Sandbox setup"}
            </button>
            <a
              href={`https://t.me/${TELEGRAM_BOT}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-[#229ED9]/30 bg-[#229ED9]/15 px-3 py-1 text-[11px] font-bold text-[#5AC8FA] hover:bg-[#229ED9]/25 transition-colors"
            >
              <Send className="h-3 w-3" />
              Use Telegram instead →
            </a>
          </div>
        </div>
      </div>

      {/* ── Expanded sandbox instructions ────────────────────────────────────── */}
      {expanded && (
        <div className="border-t border-amber-500/20 bg-amber-500/5">
          <div className="mx-auto max-w-6xl px-4 py-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-amber-400">
              📱 How to use the WhatsApp Sandbox
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {/* Step 1 */}
              <div className="rounded-2xl border border-amber-500/15 bg-amber-500/5 px-4 py-3">
                <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-amber-400">Step 1 — Join</p>
                <p className="text-xs text-muted-foreground leading-5">
                  Open WhatsApp and send a message to the sandbox number:
                </p>
                <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-white/[0.05] px-3 py-2">
                  <span className="font-mono text-sm font-bold text-amber-300">{SANDBOX_NUMBER}</span>
                  <button
                    onClick={() => copy(SANDBOX_NUMBER, "number")}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Message body (type exactly):</p>
                <div className="mt-1 flex items-center justify-between gap-2 rounded-xl bg-white/[0.05] px-3 py-2">
                  <span className="font-mono text-sm font-bold text-emerald-300">{SANDBOX_CODE}</span>
                  <button
                    onClick={() => copy(SANDBOX_CODE, "code")}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied === "code" ? (
                      <span className="text-[10px] text-emerald-400">Copied!</span>
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <a
                  href={SANDBOX_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#25D366]/15 border border-[#25D366]/25 py-2 text-[11px] font-bold text-[#25D366] hover:bg-[#25D366]/25 transition-colors"
                >
                  Open in WhatsApp
                </a>
              </div>

              {/* Step 2 */}
              <div className="rounded-2xl border border-amber-500/15 bg-amber-500/5 px-4 py-3">
                <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-amber-400">Step 2 — Use ZURIA</p>
                <p className="text-xs text-muted-foreground leading-5">
                  Once joined, talk to ZURIA on the same number:
                </p>
                <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                  {[
                    '"Sold rice 120"',
                    '"Ama owes me 200"',
                    '"balance" — today\'s report',
                    '"who owes me"',
                    '"help" — full guide',
                  ].map((ex) => (
                    <li key={ex} className="flex items-start gap-1.5">
                      <span className="mt-0.5 text-amber-400">•</span>
                      <span className="font-mono text-[11px] text-amber-200">{ex}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Step 3 */}
              <div className="rounded-2xl border border-amber-500/15 bg-amber-500/5 px-4 py-3">
                <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-amber-400">Step 3 — Rejoin every 72h</p>
                <p className="text-xs text-muted-foreground leading-5">
                  ⚠️ The sandbox session expires every{" "}
                  <strong className="text-amber-300">72 hours</strong>.
                  You must rejoin by sending{" "}
                  <span className="font-mono text-amber-300">{SANDBOX_CODE}</span>{" "}
                  again to stay connected.
                </p>
                <p className="mt-3 text-xs text-muted-foreground leading-5">
                  To avoid this, switch to <strong className="text-[#5AC8FA]">Telegram</strong> — no expiry, same features, works instantly:
                </p>
                <a
                  href={`https://t.me/${TELEGRAM_BOT}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#229ED9]/15 border border-[#229ED9]/25 py-2 text-[11px] font-bold text-[#5AC8FA] hover:bg-[#229ED9]/25 transition-colors"
                >
                  <Send className="h-3 w-3" />
                  Open ZURIA on Telegram
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
