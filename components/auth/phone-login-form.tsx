"use client";

import { useState, useEffect } from "react";
import { signInWithCustomToken } from "firebase/auth";
import { MessageCircle, Phone, ShieldCheck } from "lucide-react";
import { auth, firebaseReady } from "@/lib/firebase/config";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// ─── OTP auth is kept in the codebase but disabled until Firebase billing allows it.
// ─── See components/auth/otp-form.tsx — re-enable by swapping the login flow.

export function PhoneLoginForm() {
  const [phone, setPhone] = useState("+233");
  const [confirmPhone, setConfirmPhone] = useState("");
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) sessionStorage.setItem("zuria_ref", ref);
  }, []);

  function normalise(raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (digits.startsWith("0") && digits.length === 10) return `+233${digits.slice(1)}`;
    if (digits.startsWith("233") && digits.length === 12) return `+${digits}`;
    return raw.trim();
  }

  function goToConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const norm = normalise(phone);
    if (!/^\+\d{10,15}$/.test(norm)) {
      setError("Enter a valid WhatsApp number with country code, e.g. +233241234567 or 0241234567");
      return;
    }
    setPhone(norm);
    setStep("confirm");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const norm = normalise(confirmPhone);
    if (norm !== phone) {
      setError("The numbers don't match. Please check and try again.");
      return;
    }
    if (!auth || !firebaseReady) {
      setError("App is not configured yet. Add Firebase credentials in .env.local.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/phone-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Sign-in failed. Please try again.");
        return;
      }

      // Sign in with the custom token — this establishes a real Firebase session
      await signInWithCustomToken(auth, data.token);

      // Store phone so the onboarding form can read it (custom auth has no phoneNumber claim)
      sessionStorage.setItem("zuria_phone", phone);
      // Auth provider will detect the signed-in user and redirect automatically
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <GlassCard className="mx-auto max-w-md">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-3xl bg-primary/15 text-primary">
        <MessageCircle className="h-7 w-7" />
      </div>
      <h1 className="text-3xl font-black">Welcome to ZURIA</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Sign in with the same WhatsApp number you use for your business.
      </p>

      {!firebaseReady && (
        <p className="mt-4 rounded-2xl bg-amber-500/10 p-3 text-sm text-amber-400">
          Add Firebase credentials in .env.local to enable sign-in.
        </p>
      )}

      {step === "enter" && (
        <form className="mt-6 space-y-4" onSubmit={goToConfirm}>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Your WhatsApp number</p>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="+233241234567 or 0241234567"
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" type="submit">
            <Phone className="mr-2 h-4 w-4" /> Continue
          </Button>
        </form>
      )}

      {step === "confirm" && (
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div className="rounded-xl bg-white/[0.04] px-4 py-3">
            <p className="text-xs text-muted-foreground">Number entered</p>
            <p className="font-bold text-primary">{phone}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Type your number again to confirm</p>
            <Input
              value={confirmPhone}
              onChange={(e) => setConfirmPhone(e.target.value)}
              inputMode="tel"
              placeholder="+233241234567 or 0241234567"
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
          <button
            type="button"
            onClick={() => { setStep("enter"); setError(""); setConfirmPhone(""); }}
            className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Change number
          </button>
        </form>
      )}

      <div className="mt-6 flex items-start gap-2 rounded-xl bg-white/[0.03] px-3 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-xs text-muted-foreground leading-5">
          Your business data is protected by your WhatsApp PIN.
          Only someone who knows your 4-digit PIN can access your records on WhatsApp.
        </p>
      </div>
    </GlassCard>
  );
}
