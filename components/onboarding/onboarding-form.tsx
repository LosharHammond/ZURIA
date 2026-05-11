"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { KeyRound } from "lucide-react";
import { BUSINESS_CATEGORIES, LANGUAGES } from "@/constants/business";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/providers/auth-provider";
import { isPhoneRegistered, saveOnboarding } from "@/lib/services/business-service";
import { useAppStore } from "@/stores/app-store";

const schema = z.object({
  ownerName: z.string().min(2, "Enter your name"),
  businessName: z.string().min(2, "Enter business name"),
  category: z.enum(["provision", "food", "salon", "barber", "cosmetics", "pharmacy", "restaurant", "spare-parts", "hardware", "momo", "other"]),
  location: z.string().min(2, "Enter town or area"),
  preferredLanguage: z.enum(["english", "twi", "ga", "ewe", "hausa", "fante"]),
  whatsappPin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 numbers"),
  whatsappPinConfirm: z.string(),
}).refine((d) => d.whatsappPin === d.whatsappPinConfirm, {
  message: "PINs do not match",
  path: ["whatsappPinConfirm"],
});

type FormValues = z.infer<typeof schema>;

export function OnboardingForm() {
  const router = useRouter();
  const { firebaseUser } = useAuth();
  const { setUser, setBusiness } = useAppStore();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { category: "provision", preferredLanguage: "english" }
  });

  async function onSubmit(values: FormValues) {
    if (!firebaseUser) return;

    const phone = firebaseUser.phoneNumber ?? "";

    try {
      const alreadyRegistered = await isPhoneRegistered(phone);
      if (alreadyRegistered) {
        form.setError("root", { message: "This phone number already has a ZURIA account. Please sign in." });
        return;
      }
    } catch {
      form.setError("root", { message: "Could not verify your account. Check your connection and try again." });
      return;
    }

    const referralCode = sessionStorage.getItem("zuria_ref") ?? undefined;

    try {
      const result = await saveOnboarding({
        userId: firebaseUser.uid,
        phoneNumber: phone,
        ownerName: values.ownerName,
        businessName: values.businessName,
        category: values.category,
        location: values.location,
        preferredLanguage: values.preferredLanguage,
        whatsappPin: values.whatsappPin,
        referralCode,
      });
      sessionStorage.removeItem("zuria_ref");
      setUser(result.user);
      setBusiness(result.business);

      // Send WhatsApp welcome message — best effort, non-blocking
      const token = await firebaseUser.getIdToken();
      fetch("/api/welcome", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          ownerName: values.ownerName,
          businessName: values.businessName,
          category: values.category,
        }),
      }).catch(() => {}); // ignore failures — user is already registered

      router.replace("/welcome");
    } catch {
      form.setError("root", { message: "Failed to save your account. Check your connection and try again." });
    }
  }

  return (
    <GlassCard className="mx-auto max-w-lg">
      <p className="text-sm font-semibold text-primary">Set up your business memory</p>
      <h1 className="mt-2 text-3xl font-black">A few details, then ZURIA starts helping.</h1>

      <form className="mt-6 space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
        <Field label="Your name" error={form.formState.errors.ownerName?.message}>
          <Input placeholder="e.g. Ama Darko" {...form.register("ownerName")} />
        </Field>
        <Field label="Business name" error={form.formState.errors.businessName?.message}>
          <Input placeholder="e.g. Ama's Provision Store" {...form.register("businessName")} />
        </Field>
        <Field label="Type of business">
          <Select {...form.register("category")}>
            {BUSINESS_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </Select>
        </Field>
        <Field label="Location" error={form.formState.errors.location?.message}>
          <Input placeholder="e.g. Madina Market, Accra" {...form.register("location")} />
        </Field>
        <Field label="Preferred language">
          <Select {...form.register("preferredLanguage")}>
            {LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </Select>
        </Field>

        {/* WhatsApp PIN section */}
        <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="mb-3 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <p className="text-sm font-bold">Your WhatsApp PIN</p>
          </div>
          <p className="mb-3 text-xs text-muted-foreground leading-5">
            Choose a 4-digit PIN. You will type this when you start a WhatsApp conversation with ZURIA.
            It protects your business records from others using your number.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Choose PIN" error={form.formState.errors.whatsappPin?.message}>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
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
                className="text-center text-xl tracking-[0.4em]"
                {...form.register("whatsappPinConfirm")}
              />
            </Field>
          </div>
        </div>

        {form.formState.errors.root && (
          <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>
        )}

        <Button className="w-full" type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Creating your account..." : "Enter ZURIA"}
        </Button>
      </form>
    </GlassCard>
  );
}

function Field({ children, error, label }: { children: React.ReactNode; error?: string; label?: string }) {
  return (
    <div>
      {label && <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>}
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
