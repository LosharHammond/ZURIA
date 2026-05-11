"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, Phone, Store, User, Shield, CheckCircle2, Clock, Lock } from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/app-store";
import { useAuth } from "@/providers/auth-provider";
import { updateProfile, updateBusinessProfile } from "@/lib/services/business-service";
import { BUSINESS_CATEGORIES, LANGUAGES } from "@/constants/business";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const profileSchema = z.object({
  ownerName: z.string().min(2, "Enter your name"),
  location: z.string().min(2, "Enter your area"),
  businessName: z.string().min(2, "Enter business name"),
  preferredLanguage: z.enum(["english", "twi", "ga", "ewe", "hausa", "fante"]),
});

const pinSchema = z.object({
  currentPin: z.string().regex(/^\d{4}$/, "Enter your current 4-digit PIN"),
  newPin: z.string().regex(/^\d{4}$/, "New PIN must be 4 numbers"),
  confirmPin: z.string(),
}).refine((d) => d.newPin === d.confirmPin, { message: "PINs do not match", path: ["confirmPin"] });

type ProfileValues = z.infer<typeof profileSchema>;
type PinValues = z.infer<typeof pinSchema>;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { user, business, setUser, setBusiness } = useAppStore();
  const { firebaseUser } = useAuth();
  const [profileSaved, setProfileSaved] = useState(false);
  const [pinSaved, setPinSaved] = useState(false);

  const profileForm = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      ownerName: user?.ownerName ?? "",
      businessName: business?.name ?? "",
      location: business?.location ?? "",
      preferredLanguage: user?.preferredLanguage ?? "english",
    },
  });

  const pinForm = useForm<PinValues>({ resolver: zodResolver(pinSchema) });

  async function saveProfile(values: ProfileValues) {
    if (!user || !business) return;
    await Promise.all([
      updateProfile(user.id, { ownerName: values.ownerName, preferredLanguage: values.preferredLanguage }),
      updateBusinessProfile(business.id, { name: values.businessName, location: values.location }),
    ]);
    setUser({ ...user, ownerName: values.ownerName, preferredLanguage: values.preferredLanguage });
    setBusiness({ ...business, name: values.businessName, location: values.location });
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 3000);
  }

  async function changePin(values: PinValues) {
    if (!user || !firebaseUser) return;
    const token = await firebaseUser.getIdToken();
    const res = await fetch("/api/profile/change-pin", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ currentPin: values.currentPin, newPin: values.newPin }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        pinForm.setError("currentPin", { message: "Current PIN is wrong" });
      } else {
        pinForm.setError("currentPin", { message: data.error ?? "Something went wrong. Try again." });
      }
      return;
    }
    pinForm.reset();
    setPinSaved(true);
    setTimeout(() => setPinSaved(false), 3000);
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-primary">Your account</p>
        <h1 className="mt-1 text-3xl font-black">Profile & Settings</h1>
      </div>

      {/* Phone (read-only) */}
      <GlassCard>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
            <Phone className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Phone number (cannot change)</p>
            <p className="font-bold">{firebaseUser?.phoneNumber ?? user?.phoneNumber ?? "—"}</p>
          </div>
        </div>
      </GlassCard>

      {/* Personal & Business Info */}
      <GlassCard>
        <div className="mb-4 flex items-center gap-2">
          <User className="h-4 w-4 text-primary" />
          <h2 className="font-bold">Your details</h2>
        </div>
        <form className="space-y-4" onSubmit={profileForm.handleSubmit(saveProfile)}>
          <Field label="Your name" error={profileForm.formState.errors.ownerName?.message}>
            <Input {...profileForm.register("ownerName")} placeholder="e.g. Ama Darko" />
          </Field>
          <Field label="Business name" error={profileForm.formState.errors.businessName?.message}>
            <Input {...profileForm.register("businessName")} placeholder="e.g. Ama's Provision Store" />
          </Field>
          <Field label="Location" error={profileForm.formState.errors.location?.message}>
            <Input {...profileForm.register("location")} placeholder="e.g. Madina Market, Accra" />
          </Field>
          <Field label="Preferred language">
            <Select {...profileForm.register("preferredLanguage")}>
              {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </Select>
          </Field>
          <Button type="submit" className="w-full" disabled={profileForm.formState.isSubmitting}>
            {profileSaved ? "✓ Saved!" : profileForm.formState.isSubmitting ? "Saving..." : "Save changes"}
          </Button>
        </form>
      </GlassCard>

      {/* WhatsApp PIN */}
      <GlassCard>
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h2 className="font-bold">Change WhatsApp PIN</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground leading-5">
          Your 4-digit PIN protects your business records. Anyone messaging ZURIA on WhatsApp must enter this PIN first.
        </p>
        <form className="space-y-4" onSubmit={pinForm.handleSubmit(changePin)}>
          <Field label="Current PIN" error={pinForm.formState.errors.currentPin?.message}>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={4}
              placeholder="••••"
              className="text-center text-xl tracking-[0.4em]"
              {...pinForm.register("currentPin")}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="New PIN" error={pinForm.formState.errors.newPin?.message}>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
                className="text-center text-xl tracking-[0.4em]"
                {...pinForm.register("newPin")}
              />
            </Field>
            <Field label="Repeat new PIN" error={pinForm.formState.errors.confirmPin?.message}>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
                className="text-center text-xl tracking-[0.4em]"
                {...pinForm.register("confirmPin")}
              />
            </Field>
          </div>
          <Button type="submit" variant="outline" className="w-full" disabled={pinForm.formState.isSubmitting}>
            {pinSaved ? "✓ PIN updated!" : pinForm.formState.isSubmitting ? "Saving..." : "Change PIN"}
          </Button>
        </form>
      </GlassCard>

      {/* WhatsApp session info */}
      <WaSessionCard phone={firebaseUser?.phoneNumber ?? user?.phoneNumber} />

      {/* Business type (display only) */}
      <GlassCard>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
            <Store className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Type of business</p>
            <p className="font-bold capitalize">
              {BUSINESS_CATEGORIES.find((c) => c.value === business?.category)?.label ?? business?.category ?? "—"}
            </p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

// ─── WhatsApp session card ────────────────────────────────────────────────────

function WaSessionCard({ phone }: { userId?: string; phone?: string }) {
  const { firebaseUser } = useAuth();
  const [session, setSession] = useState<{ state: string; expiresAt: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  async function checkSession() {
    if (!phone || !firebaseUser) return;
    setLoading(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/whatsapp/session-status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setSession(await res.json());
    } finally {
      setLoading(false);
      setChecked(true);
    }
  }

  const icon = session?.state === "active"
    ? <CheckCircle2 className="h-5 w-5 text-green-400" />
    : session?.state === "locked"
      ? <Lock className="h-5 w-5 text-destructive" />
      : <Clock className="h-5 w-5 text-muted-foreground" />;

  const label = session?.state === "active"
    ? `Active — expires ${session.expiresAt ? new Date(session.expiresAt).toLocaleString() : "soon"}`
    : session?.state === "locked"
      ? "Locked — too many wrong PINs"
      : session?.state === "pending_pin"
        ? "Waiting for PIN entry"
        : "No active session";

  return (
    <GlassCard>
      <div className="mb-3 flex items-center gap-2">
        <Shield className="h-4 w-4 text-primary" />
        <h2 className="font-bold">WhatsApp session</h2>
      </div>
      {checked ? (
        <div className="flex items-center gap-3">
          {icon}
          <p className="text-sm">{label}</p>
        </div>
      ) : (
        <Button variant="outline" className="w-full" onClick={checkSession} disabled={loading}>
          {loading ? "Checking..." : "Check WhatsApp session status"}
        </Button>
      )}
    </GlassCard>
  );
}

// ─── Shared field wrapper ─────────────────────────────────────────────────────

function Field({ children, error, label }: { children: React.ReactNode; error?: string; label?: string }) {
  return (
    <div>
      {label && <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>}
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
