"use client";

/**
 * /subscription/callback
 *
 * Paystack redirects here after a payment attempt with ?ref=<reference>.
 * We verify the payment server-side and show success or failure.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-provider";
import { useAppStore } from "@/stores/app-store";
import { SUBSCRIPTION_TIERS } from "@/types/domain";
import type { SubscriptionPlan } from "@/types/domain";

type State = "verifying" | "success" | "failed" | "error";

export default function PaymentCallbackPage() {
  const searchParams  = useSearchParams();
  const router        = useRouter();
  const { firebaseUser } = useAuth();
  // Pull the surgical subscription updater — avoids a full auth re-cycle
  // just to surface the newly-activated plan in the UI.
  const updateUserSubscription = useAppStore((s) => s.updateUserSubscription);
  const ref = searchParams.get("ref");

  const [state, setState]   = useState<State>("verifying");
  const [plan, setPlan]     = useState<SubscriptionPlan | null>(null);
  const [annual, setAnnual] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    if (!ref) {
      setState("error");
      setErrMsg("No payment reference found.");
      return;
    }

    // Wait for Firebase user before verifying (with a 10-second timeout in
    // case the auth session has expired so the page doesn't hang forever).
    if (!firebaseUser) {
      const timer = setTimeout(() => {
        setState("error");
        setErrMsg("Your session has expired. Please sign in and check your subscription status.");
      }, 10_000);
      return () => clearTimeout(timer);
    }

    (async () => {
      try {
        const token = await firebaseUser.getIdToken();
        const res   = await fetch(`/api/payments/verify?ref=${encodeURIComponent(ref)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();

        if (data.ok && data.status === "success") {
          // ── CRITICAL: refresh the Zustand store immediately ─────────────────
          // Without this, the subscription page still shows the old plan after
          // redirect because auth-provider only re-fetches on onAuthStateChanged.
          // This surgical update reflects the new plan without a page refresh.
          if (data.plan) {
            updateUserSubscription(
              data.plan as SubscriptionPlan,
              data.expiresAt ?? null
            );
          }
          setPlan((data.plan ?? null) as SubscriptionPlan | null);
          setAnnual(Boolean(data.annual));
          setState("success");
          // Redirect to subscription page after 4s
          setTimeout(() => router.push("/subscription"), 4000);
        } else {
          setErrMsg(data.error ?? `Payment status: ${data.status ?? "unknown"}`);
          setState(data.status === "failed" || data.status === "abandoned" ? "failed" : "error");
        }
      } catch (err) {
        console.error("[callback] verify error:", err);
        setState("error");
        setErrMsg("Network error. Please check your subscription page.");
      }
    })();
  }, [ref, firebaseUser, router, updateUserSubscription]);

  // ── Verifying ──────────────────────────────────────────────────────────────
  if (state === "verifying") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <GlassCard className="mx-auto max-w-sm text-center">
          <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-primary" />
          <h1 className="text-xl font-black">Verifying payment…</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Please wait. Do not close this page.
          </p>
        </GlassCard>
      </div>
    );
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (state === "success") {
    const tier = plan ? SUBSCRIPTION_TIERS[plan] : null;
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <GlassCard className="mx-auto max-w-sm text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-500/15">
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            </div>
          </div>
          <h1 className="text-2xl font-black text-emerald-400">Payment successful!</h1>
          <p className="mt-2 text-sm text-muted-foreground leading-6">
            {tier ? (
              <><strong className="text-foreground">{tier.brand}</strong> is now active on your account
              {annual ? " for one year" : " for 30 days"}.
              You can record unlimited transactions via WhatsApp, Telegram, or the web.</>
            ) : (
              <>Your subscription is now active. You can record unlimited transactions via WhatsApp, Telegram, or the web.</>
            )}
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            Redirecting you to your subscription page…
          </p>
          <Button asChild className="mt-4 w-full">
            <Link href="/subscription">Go to subscription →</Link>
          </Button>
        </GlassCard>
      </div>
    );
  }

  // ── Failed / Abandoned ─────────────────────────────────────────────────────
  if (state === "failed") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <GlassCard className="mx-auto max-w-sm text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-destructive/15">
              <XCircle className="h-8 w-8 text-destructive" />
            </div>
          </div>
          <h1 className="text-2xl font-black">Payment not completed</h1>
          <p className="mt-2 text-sm text-muted-foreground leading-6">
            {errMsg || "Your payment was not completed. No money has been charged."}
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Button asChild className="w-full">
              <Link href="/subscription">Try again</Link>
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          </div>
        </GlassCard>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <GlassCard className="mx-auto max-w-sm text-center">
        <div className="mb-4 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-amber-500/15">
            <XCircle className="h-8 w-8 text-amber-400" />
          </div>
        </div>
        <h1 className="text-2xl font-black">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-6">
          {errMsg || "We could not verify your payment. If money was deducted, please contact us immediately — we will fix it."}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link href="/subscription">Check subscription status</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
