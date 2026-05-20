"use client";

import { useState } from "react";
import { Loader2, CreditCard, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-provider";
import type { SubscriptionPlan } from "@/types/domain";

interface PaystackButtonProps {
  plan: SubscriptionPlan;
  annual?: boolean;
  label?: string;
  className?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "icon";
  onSuccess?: () => void;
  onError?: (msg: string) => void;
}

/**
 * Initiates a Paystack checkout session and redirects the user to the
 * Paystack-hosted payment page. After payment, Paystack redirects back to
 * /subscription/callback?ref=<reference> where we verify and activate.
 */
export function PaystackButton({
  plan,
  annual = false,
  label,
  className,
  variant = "default",
  size = "default",
  onSuccess,
  onError,
}: PaystackButtonProps) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { firebaseUser } = useAuth();

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      if (!firebaseUser) {
        const msg = "You must be signed in to subscribe.";
        setErrorMsg(msg);
        onError?.(msg);
        setLoading(false);
        return;
      }

      // Refresh token each time to avoid expired tokens
      const token = await firebaseUser.getIdToken(/* forceRefresh= */ true);

      const res = await fetch("/api/payments/initialize", {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          Authorization:   `Bearer ${token}`,
        },
        body: JSON.stringify({ plan, annual }),
      });

      const data = await res.json();

      if (!res.ok || !data.authorizationUrl) {
        const msg = data.error ?? "Could not start payment. Please try again.";
        setErrorMsg(msg);
        onError?.(msg);
        return;
      }

      // Redirect to Paystack hosted checkout
      window.location.href = data.authorizationUrl;
      onSuccess?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error. Please try again.";
      setErrorMsg(msg);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        onClick={handleClick}
        disabled={loading}
        variant={variant}
        size={size}
        className={className}
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Preparing payment…
          </>
        ) : (
          <>
            <CreditCard className="mr-2 h-4 w-4" />
            {label ?? "Pay with Paystack"}
          </>
        )}
      </Button>

      {errorMsg && (
        <p className="flex items-start gap-1.5 text-xs text-red-400">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {errorMsg}
        </p>
      )}
    </div>
  );
}
