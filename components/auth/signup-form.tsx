"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Phone, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// Normalise any Ghana phone input → E.164 (+233XXXXXXXXX)
function normalise(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) return `+233${digits.slice(1)}`;
  if (digits.startsWith("233") && digits.length === 12) return `+${digits}`;
  return raw.trim();
}

export function SignupForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("+233");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const norm = normalise(phone);
    if (!/^\+\d{10,15}$/.test(norm)) {
      setError("Enter a valid number, e.g. +233241234567 or 0241234567");
      return;
    }

    setLoading(true);
    try {
      // Check whether this phone is already registered
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

      if (!data.isNewUser) {
        // Already registered — direct to sign in
        setError("This number already has a ZURIA account. Please sign in instead.");
        return;
      }

      // New user: store phone and go to onboarding (public page — no auth required).
      // The onboarding form will call /api/auth/register server-side to create the
      // account and return a custom token, avoiding the need for anonymous auth.
      sessionStorage.setItem("zuria_phone", norm);
      router.push("/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <GlassCard className="mx-auto max-w-md">
      <div className="mb-6">
        <Image src="/icon.svg" alt="ZURIA" width={56} height={56} className="rounded-[14px]" unoptimized />
      </div>
      <h1 className="text-3xl font-black">Create your account</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Enter the WhatsApp number you use for your business. ZURIA will connect to it.
      </p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Your WhatsApp number
          </p>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            placeholder="+233241234567 or 0241234567"
            autoComplete="tel"
            autoFocus
          />
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <Button className="w-full" type="submit" disabled={loading}>
          <Phone className="mr-2 h-4 w-4" />
          {loading ? "Checking…" : "Continue"}
          {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-primary hover:underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </form>
    </GlassCard>
  );
}
