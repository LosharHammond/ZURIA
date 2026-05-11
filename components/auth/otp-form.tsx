"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PhoneAuthProvider, signInWithCredential } from "firebase/auth";
import { KeyRound } from "lucide-react";
import { auth } from "@/lib/firebase/config";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function OtpForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    setPhone(sessionStorage.getItem("zuria_phone") ?? "");
  }, []);

  async function submit(event: React.FormEvent) {
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
      const code = (err as { code?: string }).code;
      if (code === "auth/invalid-verification-code") {
        setError("That code is incorrect. Double-check and try again.");
      } else if (code === "auth/code-expired") {
        setError("This code has expired. Go back and request a new one.");
      } else if (code === "auth/too-many-requests") {
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
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-3xl bg-secondary/15 text-secondary">
        <KeyRound className="h-7 w-7" />
      </div>
      <h1 className="text-3xl font-black">Enter your OTP</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">We sent a secure code to {phone || "your phone"}.</p>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <Input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="123456" className="text-center text-2xl tracking-[0.4em]" />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" type="submit" disabled={verifying}>
          {verifying ? "Verifying..." : "Verify and continue"}
        </Button>
      </form>
    </GlassCard>
  );
}
