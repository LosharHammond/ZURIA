"use client";

import Image from "next/image";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Phone, ShieldCheck, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Step = "enter_phone" | "verify_business" | "success";

export function ForgotPinForm() {
  const [step, setStep]       = useState<Step>("enter_phone");
  const [phone, setPhone]     = useState("+233");
  const [bizName, setBizName] = useState("");
  const [newPin, setNewPin]   = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  function normalise(raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (digits.startsWith("0") && digits.length === 10) return `+233${digits.slice(1)}`;
    if (digits.startsWith("233") && digits.length === 12) return `+${digits}`;
    return raw.trim();
  }

  // ── Step 1: validate phone and advance ───────────────────────────────────────
  function handlePhone(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const norm = normalise(phone);
    if (!/^\+\d{10,15}$/.test(norm)) {
      setError("Enter a valid number, e.g. +233241234567 or 0241234567");
      return;
    }
    setPhone(norm);
    setStep("verify_business");
  }

  // ── Step 2: verify business name + set new PIN ────────────────────────────────
  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!bizName.trim()) {
      setError("Enter your registered business name.");
      return;
    }
    if (!/^\d{4}$/.test(newPin)) {
      setError("PIN must be exactly 4 digits.");
      return;
    }
    if (newPin !== confirmPin) {
      setError("PINs don't match. Please try again.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-pin", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ phone, businessName: bizName.trim(), newPin }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Reset failed. Please check your details and try again.");
        return;
      }

      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Success ───────────────────────────────────────────────────────────────────
  if (step === "success") {
    return (
      <GlassCard className="mx-auto max-w-md text-center">
        <div className="mb-4 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-500/15">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          </div>
        </div>
        <h1 className="text-2xl font-black">PIN reset!</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-6">
          Your new 4-digit PIN is active. You can now sign in on the web, WhatsApp sandbox, and Telegram using your new PIN.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href="/login">Sign in now</Link>
        </Button>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="mx-auto max-w-md">
      {/* Header */}
      <div className="mb-6">
        <Image src="/icon.svg" alt="ZURIA" width={56} height={56} className="rounded-[14px]" unoptimized />
      </div>
      <h1 className="text-3xl font-black">Reset your PIN</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        We verify your identity using your phone number and registered business name — no OTP needed.
      </p>

      {/* Step indicators — "success" is handled by early return above, so step is "enter_phone"|"verify_business" here */}
      <div className="mt-5 flex items-center gap-2">
        {/* Step 1 */}
        <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black transition-colors ${
          step === "enter_phone" ? "bg-primary text-primary-foreground" : "bg-emerald-500/20 text-emerald-400"
        }`}>
          {step === "enter_phone" ? "1" : "✓"}
        </div>
        <div className="h-px w-8 bg-white/10" />
        {/* Step 2 */}
        <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black transition-colors ${
          step === "verify_business" ? "bg-primary text-primary-foreground" : "bg-white/10 text-muted-foreground"
        }`}>
          2
        </div>
      </div>

      {/* ── Step 1: Phone ───────────────────────────────────────────────────── */}
      {step === "enter_phone" && (
        <form className="mt-6 space-y-4" onSubmit={handlePhone}>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              <Phone className="mr-1 inline h-3 w-3" /> Your registered phone number
            </p>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="+233241234567 or 0241234567"
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" type="submit">Continue</Button>
          <div className="text-center">
            <Link href="/login" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-3 w-3" /> Back to sign in
            </Link>
          </div>
        </form>
      )}

      {/* ── Step 2: Business name + new PIN ─────────────────────────────────── */}
      {step === "verify_business" && (
        <form className="mt-6 space-y-4" onSubmit={handleReset}>
          {/* Phone display */}
          <div className="rounded-xl bg-white/[0.04] px-4 py-3">
            <p className="text-xs text-muted-foreground">Resetting PIN for</p>
            <p className="font-bold text-primary">{phone}</p>
          </div>

          {/* Business name verification */}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              <Store className="mr-1 inline h-3 w-3" /> Your registered business name
            </p>
            <Input
              value={bizName}
              onChange={(e) => setBizName(e.target.value)}
              placeholder="e.g. Ama's Provisions"
              autoFocus
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              This is the business name you entered when you created your account.
            </p>
          </div>

          {/* New PIN */}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">New 4-digit PIN</p>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••"
              autoComplete="new-password"
              className="tracking-[0.5em] text-center text-xl"
            />
          </div>

          {/* Confirm PIN */}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Confirm new PIN</p>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••"
              autoComplete="new-password"
              className="tracking-[0.5em] text-center text-xl"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? "Verifying…" : "Reset PIN"}
          </Button>

          <button
            type="button"
            onClick={() => { setStep("enter_phone"); setError(""); setBizName(""); setNewPin(""); setConfirmPin(""); }}
            className="flex w-full items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3 w-3" /> Back
          </button>
        </form>
      )}

      {/* Security note */}
      <div className="mt-6 flex items-start gap-2 rounded-xl bg-white/[0.03] px-3 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-xs text-muted-foreground leading-5">
          Your new PIN will work immediately across the web, WhatsApp sandbox, and Telegram.
          It is never shown in any chat conversation.
        </p>
      </div>
    </GlassCard>
  );
}
