"use client";

// ─────────────────────────────────────────────────────────────────────────────
// OTP AUTHENTICATION — CURRENTLY DISABLED
// ─────────────────────────────────────────────────────────────────────────────
// Firebase Phone Auth (SMS OTP) requires a paid Blaze plan.
// This component is kept intact so it can be re-enabled in the future by:
//   1. Upgrading Firebase project to Blaze plan
//   2. Restoring the OTP flow in phone-login-form.tsx
//   3. Removing the DISABLED banner below
// ─────────────────────────────────────────────────────────────────────────────

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PhoneAuthProvider, signInWithCredential } from "firebase/auth";
import { KeyRound } from "lucide-react";
import { auth } from "@/lib/firebase/config";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import Link from "next/link";

export function OtpForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    setPhone(sessionStorage.getItem("zuria_phone") ?? "");
  }, []);

  // ── OTP verification is disabled — kept for future re-enablement ─────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function _submitOtp(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const verificationId = sessionStorage.getItem("zuria_verification_id");
    if (!auth || !verificationId) {
      setError("OTP session expired. Please request a new code.");
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6 digit code.");
      return;
    }
    setVerifying(true);
    try {
      const credential = PhoneAuthProvider.credential(verificationId, code);
      await signInWithCredential(auth, credential);
      sessionStorage.removeItem("zuria_verification_id");
      sessionStorage.removeItem("zuria_phone");
      router.replace("/onboarding");
    } catch (err) {
      const errCode = (err as { code?: string }).code;
      if (errCode === "auth/invalid-verification-code") {
        setError("That code is incorrect. Double-check and try again.");
      } else if (errCode === "auth/code-expired") {
        setError("This code has expired. Go back and request a new one.");
      } else if (errCode === "auth/too-many-requests") {
        setError("Too many attempts. Please wait a few minutes before trying again.");
      } else {
        setError(err instanceof Error ? err.message : "Invalid OTP.");
      }
    } finally {
      setVerifying(false);
    }
  }

  return (
    <GlassCard className="mx-auto max-w-md">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-3xl bg-amber-500/15 text-amber-400">
        <KeyRound className="h-7 w-7" />
      </div>
      <h1 className="text-3xl font-black">OTP Verification</h1>

      {/* ── Disabled notice ── */}
      <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
        <p className="text-sm font-semibold text-amber-400 mb-1">OTP sign-in is currently disabled</p>
        <p className="text-xs text-muted-foreground leading-5">
          SMS verification requires a Firebase Blaze plan subscription.
          Please use the standard sign-in instead.
        </p>
      </div>

      <p className="mt-4 text-sm text-muted-foreground">
        We sent a secure code to {phone || "your phone"}.
      </p>

      <form className="mt-6 space-y-4" onSubmit={(e) => e.preventDefault()}>
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          placeholder="123456"
          className="text-center text-2xl tracking-[0.4em]"
          disabled
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" type="button" disabled>
          {verifying ? "Verifying..." : "Verify and continue (disabled)"}
        </Button>
      </form>

      <div className="mt-4 text-center">
        <Link href="/login" className="text-xs text-primary underline-offset-4 hover:underline">
          Back to sign-in
        </Link>
      </div>
    </GlassCard>
  );
}
