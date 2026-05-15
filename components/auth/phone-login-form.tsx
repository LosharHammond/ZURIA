"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signInWithCustomToken } from "firebase/auth";
import { KeyRound, MessageCircle, Phone, ShieldCheck, UserPlus } from "lucide-react";
import { auth, firebaseReady } from "@/lib/firebase/config";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// ─── OTP auth is kept in the codebase but disabled until Firebase billing allows it.
// ─── See components/auth/otp-form.tsx — re-enable by swapping the login flow.

type Step = "enter_phone" | "enter_pin";

export function PhoneLoginForm() {
  const router = useRouter();
  const [phone, setPhone]       = useState("+233");
  const [pin, setPin]           = useState("");
  const [step, setStep]         = useState<Step>("enter_phone");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

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

  // ── Step 1: check if user exists ──────────────────────────────────────────
  async function handlePhone(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const norm = normalise(phone);
    if (!/^\+\d{10,15}$/.test(norm)) {
      setError("Enter a valid number with country code, e.g. +233241234567 or 0241234567");
      return;
    }
    setPhone(norm);

    if (!auth || !firebaseReady) {
      setError("App is not configured yet. Add Firebase credentials in .env.local.");
      return;
    }

    setLoading(true);
    try {
      const res  = await fetch("/api/auth/phone-login", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ phone: norm }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      if (data.isNewUser) {
        // No ZURIA account yet — send them to sign up.
        // /signup will store the phone and go to /onboarding (public page).
        // No anonymous auth needed; server-side registration handles account creation.
        sessionStorage.setItem("zuria_phone", norm);
        router.push(`/signup`);
        return;
      }

      // Returning user — ask for PIN
      setStep("enter_pin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: verify PIN and sign in ────────────────────────────────────────
  async function handlePin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!/^\d{4}$/.test(pin)) {
      setError("Enter your 4-digit PIN.");
      return;
    }

    setLoading(true);
    try {
      const res  = await fetch("/api/auth/phone-login", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ phone, pin }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Incorrect PIN. Please try again.");
        return;
      }

      // Sign in with the custom token — establishes a real Firebase session
      await signInWithCustomToken(auth!, data.token);
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
        Sign in with your phone number and 4-digit PIN.
      </p>

      {!firebaseReady && (
        <p className="mt-4 rounded-2xl bg-amber-500/10 p-3 text-sm text-amber-400">
          Add Firebase credentials in .env.local to enable sign-in.
        </p>
      )}

      {/* ── Step 1: Phone number ─────────────────────────────────────────── */}
      {step === "enter_phone" && (
        <form className="mt-6 space-y-4" onSubmit={handlePhone}>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Your phone number</p>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="+233241234567 or 0241234567"
              autoComplete="tel"
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" type="submit" disabled={loading}>
            <Phone className="mr-2 h-4 w-4" />
            {loading ? "Checking…" : "Continue"}
          </Button>

          {/* ── Create Account CTA ──────────────────────────────────────── */}
          <div className="relative flex items-center py-1">
            <div className="flex-1 border-t border-white/10" />
            <span className="mx-3 text-xs text-muted-foreground">or</span>
            <div className="flex-1 border-t border-white/10" />
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full border-primary/30 text-primary hover:bg-primary/10"
            onClick={() => router.push("/signup")}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Create Account
          </Button>
        </form>
      )}

      {/* ── Step 2: 4-digit PIN ──────────────────────────────────────────── */}
      {step === "enter_pin" && (
        <form className="mt-6 space-y-4" onSubmit={handlePin}>
          <div className="rounded-xl bg-white/[0.04] px-4 py-3">
            <p className="text-xs text-muted-foreground">Signing in as</p>
            <p className="font-bold text-primary">{phone}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Your 4-digit PIN</p>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••"
              autoComplete="current-password"
              autoFocus
              className="tracking-[0.5em] text-center text-xl"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" type="submit" disabled={loading}>
            <KeyRound className="mr-2 h-4 w-4" />
            {loading ? "Verifying…" : "Sign in"}
          </Button>
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => { setStep("enter_phone"); setError(""); setPin(""); }}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Different number
            </button>
            <Link
              href="/forgot-pin"
              className="text-primary/80 hover:text-primary underline-offset-4 hover:underline transition-colors"
            >
              Forgot PIN?
            </Link>
          </div>
        </form>
      )}

      <div className="mt-6 flex items-start gap-2 rounded-xl bg-white/[0.03] px-3 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-xs text-muted-foreground leading-5">
          Your 4-digit PIN protects your business data on the web, WhatsApp, and Telegram.
          It is never visible in any chat conversation.
        </p>
      </div>
    </GlassCard>
  );
}
