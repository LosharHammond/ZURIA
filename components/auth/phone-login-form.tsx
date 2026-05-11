"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { Phone } from "lucide-react";
import { auth, firebaseReady } from "@/lib/firebase/config";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

declare global {
  interface Window {
    zuriaRecaptcha?: RecaptchaVerifier;
  }
}

export function PhoneLoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("+233");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) sessionStorage.setItem("zuria_ref", ref);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!auth) {
      setError("Firebase is not configured yet. Add your .env.local values and restart the app.");
      return;
    }
    if (!/^\+\d{10,15}$/.test(phone.replace(/\s+/g, ""))) {
      setError("Enter the phone number with country code, e.g. +233241234567.");
      return;
    }
    setSending(true);
    try {
      if (!window.zuriaRecaptcha) {
        try {
          window.zuriaRecaptcha = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
        } catch {
          setError("reCAPTCHA failed to load. Refresh the page and try again.");
          return;
        }
      }
      const result = await signInWithPhoneNumber(auth, phone.replace(/\s+/g, ""), window.zuriaRecaptcha);
      sessionStorage.setItem("zuria_verification_id", result.verificationId);
      sessionStorage.setItem("zuria_phone", phone.replace(/\s+/g, ""));
      router.push("/verify");
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "auth/too-many-requests") {
        setError("Too many attempts. Please wait a few minutes and try again.");
      } else if (code === "auth/invalid-phone-number") {
        setError("That phone number isn't valid. Include your country code, e.g. +233241234567.");
      } else if (code === "auth/quota-exceeded") {
        setError("SMS quota exceeded. Please try again later.");
      } else if (code === "auth/captcha-check-failed") {
        window.zuriaRecaptcha = undefined;
        setError("Security check failed. Refresh the page and try again.");
      } else {
        setError(err instanceof Error ? err.message : "Unable to send OTP. Check the number and try again.");
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <GlassCard className="mx-auto max-w-md">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-3xl bg-primary/15 text-primary">
        <Phone className="h-7 w-7" />
      </div>
      <h1 className="text-3xl font-black">Welcome to ZURIA</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Sign in with your phone number. We’ll send a quick OTP to keep your business records protected.</p>
      {!firebaseReady && <p className="mt-4 rounded-2xl bg-secondary/15 p-3 text-sm text-secondary">Add Firebase web config values in .env.local to enable live authentication.</p>}
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <Input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" placeholder="+233241234567" />
        <div id="recaptcha-container" />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" type="submit" disabled={sending}>
          {sending ? "Sending OTP..." : "Send OTP"}
        </Button>
      </form>
    </GlassCard>
  );
}
