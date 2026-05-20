"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, ChevronLeft, RefreshCw, AlertTriangle } from "lucide-react";
import { signInWithCustomToken } from "firebase/auth";
import { BUSINESS_CATEGORIES, LANGUAGES } from "@/constants/business";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { auth } from "@/lib/firebase/config";
import { useAppStore } from "@/stores/app-store";
import type { AppUser, Business } from "@/types/domain";

// ─── Validation ────────────────────────────────────────────────────────────────

// Mirror of the server-side weak PIN list in lib/security/pin.ts
const WEAK_PINS = new Set([
  "0000","1111","2222","3333","4444","5555","6666","7777","8888","9999",
  "1234","4321","0123","9876","1212","2121","1122","2211","1313","3131",
  "2580","0852","2468","1357","1470","7410","0007","6969","1000","0001",
]);

const schema = z.object({
  phone: z
    .string()
    .regex(/^\+?\d{10,15}$/, "Enter a valid phone number, e.g. 0241234567"),
  ownerName:         z.string().min(2, "Enter your name").max(80),
  businessName:      z.string().min(2, "Enter your business name").max(120),
  category:          z.enum(["provision", "food", "salon", "barber", "cosmetics", "pharmacy", "restaurant", "spare-parts", "hardware", "momo", "other"]),
  location:          z.string().min(2, "Enter your town or area").max(100),
  preferredLanguage: z.enum(["english", "twi", "ga", "ewe", "hausa", "fante"]),
  whatsappPin:       z.string().regex(/^\d{4}$/, "PIN must be exactly 4 numbers").refine(
    (p) => !WEAK_PINS.has(p),
    "That PIN is too easy to guess. Use a random 4-digit combination."
  ),
  whatsappPinConfirm: z.string(),
}).refine((d) => d.whatsappPin === d.whatsappPinConfirm, {
  message: "PINs do not match",
  path: ["whatsappPinConfirm"],
});

type FormValues = z.infer<typeof schema>;

// ─── Normalise phone ───────────────────────────────────────────────────────────

function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) return `+233${digits.slice(1)}`;
  if (digits.startsWith("233") && digits.length === 12) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return raw.trim();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OnboardingForm() {
  const router = useRouter();
  const { setUser, setBusiness } = useAppStore();

  // Store the referral code in a ref so it's accessible in onSubmit without
  // causing a hydration mismatch (sessionStorage is client-only).
  const referralCodeRef = useRef<string | undefined>(undefined);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      // Always start with "" on both server and client — prevents hydration
      // mismatch caused by sessionStorage reads differing between SSR and client.
      phone:             "",
      category:          "provision",
      preferredLanguage: "english",
    },
  });

  // Read sessionStorage after mount (client-only — no SSR mismatch).
  useEffect(() => {
    const savedPhone = sessionStorage.getItem("zuria_phone");
    const savedRef   = sessionStorage.getItem("zuria_ref");
    if (savedPhone) form.setValue("phone", savedPhone, { shouldValidate: false });
    if (savedRef)   referralCodeRef.current = savedRef;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(values: FormValues) {
    const phone = normalisePhone(values.phone);

    if (!/^\+\d{10,15}$/.test(phone)) {
      form.setError("phone", { message: "Enter a valid number with country code, e.g. 0241234567" });
      return;
    }

    try {
      // ── Server-side account creation ──────────────────────────────────────
      // /api/auth/register creates the Firebase Auth user + Firestore records
      // and returns a custom token — no anonymous auth needed.
      const res = await fetch("/api/auth/register", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          ownerName:         values.ownerName,
          businessName:      values.businessName,
          category:          values.category,
          location:          values.location,
          preferredLanguage: values.preferredLanguage,
          pin:               values.whatsappPin,
          referralCode:      referralCodeRef.current,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Phone already registered → guide them to sign in
        if (res.status === 409) {
          form.setError("phone", {
            message: "This number already has an account. Please sign in instead.",
          });
          return;
        }
        form.setError("root", {
          message: data.error ?? "Registration failed. Please check your connection and try again.",
        });
        return;
      }

      // ── Populate Zustand store immediately from API response ──────────────
      // This avoids a Firestore round-trip before the welcome page renders.
      if (data.user)     setUser(data.user as AppUser);
      if (data.business) setBusiness(data.business as Business);

      // ── Sign in with the custom token returned by the server ──────────────
      if (!auth) {
        form.setError("root", { message: "Firebase is not configured. Add .env.local values." });
        return;
      }
      await signInWithCustomToken(auth, data.token);

      // ── CRITICAL: write the session cookie BEFORE navigating ───────────────
      // signInWithCustomToken resolves but onAuthStateChanged fires asynchronously.
      // If we call router.replace("/welcome") here the middleware checks for
      // the session cookie, finds nothing, and bounces the user back to /login.
      // Explicitly creating the cookie synchronously closes that race window.
      const idToken = await auth.currentUser?.getIdToken();
      if (idToken) {
        await fetch("/api/auth/session", {
          method:  "POST",
          headers: { Authorization: `Bearer ${idToken}` },
        }).catch(() => {}); // Non-fatal — auth provider will retry via withRetry
      }

      // Clean up sessionStorage artifacts
      sessionStorage.removeItem("zuria_phone");
      sessionStorage.removeItem("zuria_ref");

      // Send WhatsApp welcome + referral credit (best-effort, non-blocking)
      if (idToken) {
        fetch("/api/welcome", {
          method:  "POST",
          headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            phone,
            ownerName:    values.ownerName,
            businessName: values.businessName,
            category:     values.category,
            referralCode: referralCodeRef.current,
          }),
        }).catch(() => {});
      }

      router.replace("/welcome");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      form.setError("root", { message: msg });
    }
  }

  const isSubmitting  = form.formState.isSubmitting;
  const rootError     = form.formState.errors.root?.message;
  const watchedPin    = useWatch({ control: form.control, name: "whatsappPin" });
  const isPinWeak     = watchedPin?.length === 4 && WEAK_PINS.has(watchedPin);

  return (
    <GlassCard className="mx-auto max-w-lg">
      {/* Back navigation */}
      <button
        type="button"
        onClick={() => router.back()}
        className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back
      </button>

      <p className="text-sm font-semibold text-primary">Create your ZURIA account</p>
      <h1 className="mt-1 text-3xl font-black leading-tight">
        A few details, then ZURIA starts helping.
      </h1>

      <form className="mt-6 space-y-4" onSubmit={form.handleSubmit(onSubmit)}>

        {/* Phone number — pre-filled from signup flow but editable */}
        <Field label="Your WhatsApp number" error={form.formState.errors.phone?.message}>
          <Input
            placeholder="0241234567 or +233241234567"
            inputMode="tel"
            autoComplete="tel"
            {...form.register("phone")}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            This is how ZURIA identifies you on WhatsApp.
          </p>
        </Field>

        <Field label="Your name" error={form.formState.errors.ownerName?.message}>
          <Input placeholder="e.g. Ama Darko" autoComplete="name" {...form.register("ownerName")} />
        </Field>

        <Field label="Business name" error={form.formState.errors.businessName?.message}>
          <Input placeholder="e.g. Ama's Provision Store" autoComplete="organization" {...form.register("businessName")} />
        </Field>

        <Field label="Type of business">
          <Select {...form.register("category")}>
            {BUSINESS_CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </Select>
        </Field>

        <Field label="Location" error={form.formState.errors.location?.message}>
          <Input placeholder="e.g. Madina Market, Accra" autoComplete="address-level2" {...form.register("location")} />
        </Field>

        <Field label="Preferred language">
          <Select {...form.register("preferredLanguage")}>
            {LANGUAGES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </Select>
        </Field>

        {/* PIN section */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="mb-2 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <p className="text-sm font-bold">Your WhatsApp PIN</p>
          </div>
          <p className="mb-3 text-xs leading-5 text-muted-foreground">
            Choose a 4-digit PIN. You will type this when you start a WhatsApp
            conversation with ZURIA to protect your business records.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Choose PIN" error={form.formState.errors.whatsappPin?.message}>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
                autoComplete="new-password"
                className="text-center text-xl tracking-[0.4em]"
                {...form.register("whatsappPin")}
              />
            </Field>
            <Field label="Repeat PIN" error={form.formState.errors.whatsappPinConfirm?.message}>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
                autoComplete="new-password"
                className="text-center text-xl tracking-[0.4em]"
                {...form.register("whatsappPinConfirm")}
              />
            </Field>
          </div>
          {isPinWeak && (
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <p className="text-xs text-amber-400">
                That PIN is too easy to guess. Choose something random — not a sequence or repeated digit.
              </p>
            </div>
          )}
        </div>

        {/* Root-level error with retry CTA */}
        {rootError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
            <p className="text-sm text-destructive">{rootError}</p>
            <button
              type="button"
              onClick={() => form.clearErrors("root")}
              className="mt-1 flex items-center gap-1.5 text-xs text-destructive/80 hover:text-destructive transition-colors"
            >
              <RefreshCw className="h-3 w-3" /> Try again
            </button>
          </div>
        )}

        <Button className="w-full" type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Creating your account…
            </>
          ) : (
            "Enter ZURIA →"
          )}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </button>
        </p>
      </form>
    </GlassCard>
  );
}

// ─── Field wrapper ─────────────────────────────────────────────────────────────

function Field({ children, error, label }: { children: React.ReactNode; error?: string; label?: string }) {
  return (
    <div>
      {label && <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>}
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
