"use client";

import Link from "next/link";
import { MessageCircle, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/app-store";

const WA_NUMBER = process.env.NEXT_PUBLIC_WA_NUMBER;
const WA_LINK = WA_NUMBER ? `https://wa.me/${WA_NUMBER}?text=Hello` : null;

export default function WelcomePage() {
  const { user } = useAppStore();
  const firstName = user?.ownerName?.split(" ")[0] ?? "there";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-10 text-center">
      {/* Celebration animation */}
      <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-primary/15 text-5xl shadow-2xl">
        🎉
      </div>

      <div className="mb-2 flex items-center justify-center gap-2 text-primary text-sm font-semibold tracking-wide">
        <Sparkles className="h-4 w-4" />
        Account created!
        <Sparkles className="h-4 w-4" />
      </div>

      <h1 className="text-4xl font-black leading-tight">
        Welcome,<br />{firstName}!
      </h1>

      <p className="mt-4 max-w-xs text-base text-muted-foreground leading-7">
        ZURIA is your AI Business Assistant — available on WhatsApp and Telegram. Record your sales, expenses, and debts in plain language, any time, anywhere.
      </p>

      {/* WhatsApp CTA — primary action */}
      {WA_LINK ? (
        <a
          href={WA_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 w-full max-w-xs"
        >
          <Button className="w-full gap-3 rounded-2xl bg-[#25D366] py-6 text-base font-bold text-white hover:bg-[#1ebe5d]">
            <MessageCircle className="h-6 w-6" />
            Open WhatsApp &amp; Start
          </Button>
        </a>
      ) : (
        <div className="mt-8 w-full max-w-xs rounded-2xl border border-secondary/30 bg-secondary/10 p-4 text-center">
          <p className="text-sm text-muted-foreground">WhatsApp number not configured. Set <code className="text-xs">NEXT_PUBLIC_WA_NUMBER</code> in your environment.</p>
        </div>
      )}

      <p className="mt-3 max-w-xs text-xs text-muted-foreground leading-5">
        Tap the button above. WhatsApp will open — just send any message and ZURIA will guide you from there.
      </p>

      {/* Step hints */}
      <div className="mt-8 w-full max-w-xs space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">How to use ZURIA</p>
        {[
          { emoji: "1️⃣", text: 'Send "Sold rice 120" to record a sale' },
          { emoji: "2️⃣", text: 'Send "Ama owes me 200" for credit sales' },
          { emoji: "3️⃣", text: 'Send "balance" to see today\'s report' },
        ].map((step) => (
          <div key={step.text} className="flex items-start gap-3">
            <span className="text-xl">{step.emoji}</span>
            <p className="text-sm leading-5 text-muted-foreground">{step.text}</p>
          </div>
        ))}
      </div>

      {/* Secondary — go to dashboard */}
      <Link href="/dashboard" className="mt-6 w-full max-w-xs">
        <Button variant="outline" className="w-full gap-2 rounded-2xl">
          Go to my dashboard
          <ChevronRight className="h-4 w-4" />
        </Button>
      </Link>
    </main>
  );
}
