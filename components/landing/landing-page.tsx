"use client";

import Link from "next/link";
import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Brain,
  Building2,
  CheckCircle2,
  CloudOff,
  Cpu,
  DatabaseZap,
  HandCoins,
  Languages,
  MessageCircle,
  Package,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  WifiOff,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ── Animation helpers ─────────────────────────────────────────────────────────

function FadeUp({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 28 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay, ease: [0.25, 0.1, 0.25, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ── Data ──────────────────────────────────────────────────────────────────────

const features = [
  {
    icon: MessageCircle,
    title: "WhatsApp-native recording",
    text: 'Type "Sold rice 120" and ZURIA understands instantly. No forms, no training, no accountant needed.',
    badge: "Core",
  },
  {
    icon: CloudOff,
    title: "Fully offline-capable",
    text: "Lost signal at Makola? Record sales anyway. Everything syncs automatically when you're back online.",
    badge: "PWA",
  },
  {
    icon: HandCoins,
    title: "Credit & debt memory",
    text: "Track every customer who owes you, every payment received, and every outstanding balance — all in one place.",
    badge: "Finance",
  },
  {
    icon: TrendingUp,
    title: "Live business dashboard",
    text: "Sales, expenses, profit, and warnings displayed in a single calm view. Always know how today is going.",
    badge: "Insights",
  },
  {
    icon: Brain,
    title: "AI-powered summaries",
    text: "Business memory that learns your daily rhythm and surfaces the numbers that matter — without forcing accounting habits.",
    badge: "AI",
  },
  {
    icon: ShieldCheck,
    title: "Enterprise-grade security",
    text: "Phone authentication, end-to-end Firestore security rules, PIN protection, and encrypted cloud sync from day one.",
    badge: "Security",
  },
];

const steps = [
  {
    number: "01",
    title: "Sign in with your phone",
    text: "No email, no password. Just your Ghanaian phone number. You're in within 30 seconds.",
  },
  {
    number: "02",
    title: "Record in plain language",
    text: 'Type exactly how you think: "Sold rice 120", "Ama owes me 200", "Paid ECG 80". ZURIA does the rest.',
  },
  {
    number: "03",
    title: "Watch your business grow",
    text: "Daily summaries, profit trends, stock alerts, and credit tracking all update live — no manual work.",
  },
];

const businessTypes = [
  { emoji: "🛒", name: "Provision Stores" },
  { emoji: "💇", name: "Salons & Barbers" },
  { emoji: "🍲", name: "Restaurants" },
  { emoji: "💊", name: "Pharmacies" },
  { emoji: "🔧", name: "Spare Parts" },
  { emoji: "🧴", name: "Cosmetics" },
  { emoji: "📱", name: "MoMo Agents" },
  { emoji: "🏗️", name: "Hardware Shops" },
];

const stats = [
  { value: "17+", label: "Transaction types tracked" },
  { value: "6", label: "Local languages supported" },
  { value: "100%", label: "Offline capable" },
  { value: "< 30s", label: "Time to first record" },
];

const whatsappConversation = [
  { side: "user", text: "Sold rice 3 bags 360" },
  { side: "zuria", text: "✅ Recorded: 3 bags rice · GHS 360 income\nStock: rice updated to 17 bags remaining" },
  { side: "user", text: "Ama owes me 200" },
  { side: "zuria", text: "✅ Credit sale recorded · GHS 200 owed by Ama\nTotal owed to you: GHS 650" },
  { side: "user", text: "balance" },
  { side: "zuria", text: "📊 Today · Ama Stores\nIncome: GHS 560\nExpenses: GHS 80\nProfit: GHS 480 🟢\n\nStock alert: Groundnut oil running low!" },
];

// ── Pricing data ──────────────────────────────────────────────────────────────

const pricingTiers = [
  {
    id: "free",
    badge: "Always Free",
    badgeVariant: "outline" as const,
    name: "Starter Ledger",
    tagline: "Start your business memory today",
    price: 0,
    annualPrice: null,
    color: "text-muted-foreground",
    borderColor: "border-white/10",
    glowColor: "",
    target: "Market women · Kiosks · Solo hustlers",
    highlight: false,
    limits: ["10 AI entries per day", "1 business account", "30-day history"],
    features: [
      "Voice & text transaction recording",
      "AI transaction parsing in 6 local languages",
      "Sales, expense & debt logging",
      "Simple debt tracking",
      "Daily business summary",
      "Weekly SMS-style report",
      "Basic business health score",
      "Low-stock alerts",
      "Offline-first — works without internet",
      "WhatsApp PIN security",
    ],
    cta: "Start free",
    ctaVariant: "outline" as const,
  },
  {
    id: "growth",
    badge: "Most Popular",
    badgeVariant: "success" as const,
    name: "ZURIA Growth",
    tagline: "Your digital shop assistant",
    price: 20,
    annualPrice: 200,
    color: "text-emerald-400",
    borderColor: "border-emerald-500/30",
    glowColor: "from-emerald-500/8",
    target: "Small shops · Salons · MoMo vendors · Food vendors",
    highlight: true,
    limits: ["200 AI entries per month", "Unlimited voice notes"],
    features: [
      "Everything in Starter Ledger",
      "Smart transaction categorization",
      "Auto debt reminders via WhatsApp",
      "AI-generated sales insights in local language",
      "AI business tips daily",
      "Monthly profit reports",
      "Expense analysis & breakdown",
      "Top-selling products report",
      "Customer debt summaries",
      "Inventory tracking & restock predictions",
      "Low-stock forecasting",
      "Multi-device sync",
      "Export to PDF/Excel",
      "WhatsApp daily summaries",
      "Custom business name & branding",
    ],
    cta: "Get Growth",
    ctaVariant: "default" as const,
  },
  {
    id: "pro",
    badge: "Best Value",
    badgeVariant: "secondary" as const,
    name: "ZURIA Pro",
    tagline: "The African SME operating system",
    price: 50,
    annualPrice: 500,
    color: "text-cyan-400",
    borderColor: "border-cyan-500/30",
    glowColor: "from-cyan-500/8",
    target: "Pharmacies · Restaurants · Hardware shops · Distributors",
    highlight: false,
    limits: ["Unlimited AI entries", "All features unlocked"],
    features: [
      "Everything in Growth",
      "AI detects unusual spending patterns",
      "AI cash-flow forecasting",
      "Predictive business health scoring",
      "AI profit leakage detection",
      "AI recommendations engine",
      "Staff accounts & employee permissions",
      "Activity logs & staff sales tracking",
      "Advanced analytics dashboard",
      "Profit trends & peak sales hours",
      "Expense heatmaps",
      "Debt recovery probability scoring",
      "Customer purchase history & insights",
      "Loyal customer tracking",
      "Auto-generated invoices",
      "Smart recurring reminders",
      "Scheduled reports",
      "AI business coach chatbot",
      "Biometric login & cloud backup priority",
    ],
    cta: "Get Pro",
    ctaVariant: "outline" as const,
  },
  {
    id: "enterprise",
    badge: "Full Power",
    badgeVariant: "warning" as const,
    name: "ZURIA Enterprise",
    tagline: "Commercial intelligence infrastructure",
    price: 100,
    annualPrice: 1000,
    color: "text-amber-400",
    borderColor: "border-amber-500/30",
    glowColor: "from-amber-500/8",
    target: "Large retailers · Chains · Distributors · Wholesalers · Franchises",
    highlight: false,
    limits: ["Unlimited everything", "Multi-branch ready", "API access"],
    features: [
      "Everything in Pro",
      "Multi-branch management",
      "Consolidated analytics & regional dashboards",
      "Branch comparison AI",
      "Executive KPI dashboards",
      "AI growth forecasting",
      "Business valuation estimates",
      "Expansion recommendations",
      "Supplier & purchase order management",
      "Bulk stock intelligence & supplier debt tracking",
      "Cash-flow simulations",
      "Tax estimation & audit logs",
      'Ask AI anything — "Why are profits down?"',
      "Unlimited staff & department roles",
      "Approval systems",
      "POS, MoMo & bank integrations",
      "Dedicated support & onboarding",
      "Data migration service",
    ],
    cta: "Get Enterprise",
    ctaVariant: "outline" as const,
  },
];

// ── Moat features ─────────────────────────────────────────────────────────────

const moatFeatures = [
  {
    icon: DatabaseZap,
    title: "Business Memory",
    color: "text-primary",
    bg: "bg-primary/10",
    description:
      "ZURIA remembers your suppliers, customer debts, seasonal sales patterns, spending habits, peak days, and repeat buyers. Not bookkeeping. Memory.",
    examples: ["Kofi always buys on Fridays", "Groundnut oil spikes before school terms", "Ama still owes from last month"],
  },
  {
    icon: Languages,
    title: "Local Language AI",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    description:
      'Voice input in Twi, Ga, Hausa, Ewe, and Fante. "Kofi took bread and owes me 50 cedis." ZURIA parses automatically. That\'s billion-cedi territory in Africa.',
    examples: ["Twi", "Ga", "Hausa", "Ewe", "Fante", "English"],
  },
  {
    icon: WifiOff,
    title: "Offline-First Engine",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    description:
      "Most African SME software fails here. ZURIA works offline, syncs later, and survives poor connectivity. This is a major trust differentiator.",
    examples: ["Record at Makola with no signal", "Auto-sync when back online", "Never lose a transaction"],
  },
  {
    icon: Cpu,
    title: "AI Business Coach",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    description:
      "Daily intelligence that makes ZURIA feel alive. Not just a recorder — an advisor that knows your business as well as you do.",
    examples: [
      "Expenses increased 24% this week",
      "Rice sales rise every Friday",
      "Recover Ama's debt before month-end",
    ],
  },
  {
    icon: MessageCircle,
    title: "WhatsApp Commerce Layer",
    color: "text-secondary",
    bg: "bg-secondary/10",
    description:
      "Most SMEs live inside WhatsApp. ZURIA turns WhatsApp into a full business operating system. Record, query, and get reports without opening an app.",
    examples: ['"Sold 3 Coke 45 cedis cash"', '"Who owes me?"', '"Monthly report"'],
  },
  {
    icon: Building2,
    title: "Multi-Branch Intelligence",
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    description:
      "Enterprise users get branch management, consolidated analytics, and AI that compares performance across locations — like a mini SAP for African SMEs.",
    examples: ["Branch A vs Branch B", "Which location wastes most?", "Regional revenue dashboard"],
  },
];

// ── Sections ──────────────────────────────────────────────────────────────────

function NavBar() {
  return (
    <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-lg font-black text-primary-foreground shadow-lg shadow-primary/20">
            Z
          </span>
          <span className="font-bold tracking-[0.22em] text-sm">ZURIA</span>
        </Link>
        <div className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
          <Link href="#features" className="hover:text-foreground transition-colors">Features</Link>
          <Link href="#how-it-works" className="hover:text-foreground transition-colors">How it works</Link>
          <Link href="#pricing" className="hover:text-foreground transition-colors">Pricing</Link>
          <Link href="#for-you" className="hover:text-foreground transition-colors">For your business</Link>
        </div>
        <Button asChild size="sm">
          <Link href="/login" className="gap-2">
            Open app <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </nav>
  );
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden pb-24 pt-20">
      {/* Ambient gradient background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-0 h-[700px] w-[900px] -translate-x-1/2 rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute right-0 top-1/4 h-[400px] w-[400px] rounded-full bg-secondary/5 blur-[80px]" />
        <div className="absolute bottom-0 left-0 h-[300px] w-[500px] rounded-full bg-accent/5 blur-[100px]" />
      </div>

      <div className="mx-auto max-w-6xl px-4">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_460px]">
          {/* Left — copy */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                The AI memory system for African businesses
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.08 }}
              className="mt-6 text-5xl font-black leading-[0.92] tracking-tight text-balance md:text-7xl"
            >
              Your shop.<br />
              <span className="text-primary">Your money.</span><br />
              Your memory.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.16 }}
              className="mt-6 max-w-lg text-lg leading-7 text-muted-foreground"
            >
              Old merchants kept wisdom in notebooks and memory.
              ZURIA transforms that ancient rhythm into{" "}
              <span className="text-foreground font-medium">living intelligence</span> —
              a digital accountant, business advisor, debt tracker, and sales engine in one.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.24 }}
              className="mt-8 flex flex-wrap gap-3"
            >
              <Button asChild size="default" className="gap-2 shadow-lg shadow-primary/20">
                <Link href="/login">
                  Start for free <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="default">
                <Link href="#pricing">See plans</Link>
              </Button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="mt-8 flex flex-wrap gap-4 text-sm text-muted-foreground"
            >
              {["No credit card needed", "Works offline", "6 local languages"].map((item) => (
                <span key={item} className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  {item}
                </span>
              ))}
            </motion.div>
          </div>

          {/* Right — WhatsApp demo card */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
          >
            <GlassCard className="overflow-hidden p-0">
              {/* Header bar */}
              <div className="flex items-center gap-3 border-b border-white/[0.06] bg-white/[0.03] px-4 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#25D366]/20 text-lg">🤖</div>
                <div>
                  <p className="text-sm font-bold">ZURIA Assistant</p>
                  <p className="text-xs text-primary">● Online</p>
                </div>
              </div>

              {/* Conversation */}
              <div className="space-y-3 p-4">
                {whatsappConversation.map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 + i * 0.18, duration: 0.4 }}
                    className={`flex ${msg.side === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-5 whitespace-pre-line ${
                        msg.side === "user"
                          ? "rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm bg-white/[0.07] text-foreground"
                      }`}
                    >
                      {msg.text}
                    </div>
                  </motion.div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function StatsBar() {
  return (
    <section className="border-y border-white/[0.06] bg-white/[0.02]">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {stats.map((stat, i) => (
            <FadeUp key={stat.label} delay={i * 0.08}>
              <div className="text-center">
                <p className="text-3xl font-black text-primary">{stat.value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-24">
      <FadeUp>
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-secondary/20 bg-secondary/10 px-3 py-1 text-xs font-semibold text-secondary">
          <Zap className="h-3 w-3" /> Platform capabilities
        </div>
        <h2 className="max-w-2xl text-4xl font-black leading-tight md:text-5xl">
          Built around real business behaviour.
        </h2>
        <p className="mt-4 max-w-xl text-muted-foreground">
          No ledgers. No training. No spreadsheet face. Just memory, clarity, and action — in the language your business already speaks.
        </p>
      </FadeUp>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature, i) => (
          <FadeUp key={feature.title} delay={i * 0.07}>
            <GlassCard className="group h-full hover:border-primary/20 transition-colors duration-300">
              <div className="flex items-start justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
                  <feature.icon className="h-5 w-5" />
                </div>
                <Badge variant="outline" className="text-[10px]">{feature.badge}</Badge>
              </div>
              <h3 className="mt-5 text-base font-bold">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.text}</p>
            </GlassCard>
          </FadeUp>
        ))}
      </div>
    </section>
  );
}

function MoatSection() {
  return (
    <section className="border-y border-white/[0.06] bg-white/[0.015]">
      <div className="mx-auto max-w-6xl px-4 py-24">
        <FadeUp>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Star className="h-3 w-3" /> Why ZURIA dominates
          </div>
          <h2 className="max-w-2xl text-4xl font-black leading-tight md:text-5xl">
            Features that create an unbeatable moat.
          </h2>
          <p className="mt-4 max-w-xl text-muted-foreground">
            ZURIA is not accounting software, an inventory app, or a bookkeeping tool. That market is crowded.
            ZURIA is the <span className="text-foreground font-semibold">AI memory system for African businesses.</span>
          </p>
        </FadeUp>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {moatFeatures.map((f, i) => (
            <FadeUp key={f.title} delay={i * 0.07}>
              <GlassCard className="group h-full hover:border-primary/20 transition-colors duration-300">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${f.bg}`}>
                  <f.icon className={`h-6 w-6 ${f.color}`} />
                </div>
                <h3 className={`mt-4 text-base font-black ${f.color}`}>{f.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{f.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {f.examples.map((ex) => (
                    <span key={ex} className="rounded-lg bg-white/[0.05] px-2.5 py-1 text-[11px] text-muted-foreground">
                      {ex}
                    </span>
                  ))}
                </div>
              </GlassCard>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section id="how-it-works" className="border-b border-white/[0.06]">
      <div className="mx-auto max-w-6xl px-4 py-24">
        <FadeUp>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
            <CheckCircle2 className="h-3 w-3" /> Three simple steps
          </div>
          <h2 className="max-w-xl text-4xl font-black leading-tight md:text-5xl">
            Up and running in under 2 minutes.
          </h2>
        </FadeUp>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {steps.map((step, i) => (
            <FadeUp key={step.number} delay={i * 0.12}>
              <div className="relative">
                {i < steps.length - 1 && (
                  <div className="absolute left-[calc(100%+12px)] top-5 hidden h-px w-6 bg-white/10 md:block" />
                )}
                <div className="mb-5 inline-flex items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 px-4 py-2">
                  <span className="font-black text-primary">{step.number}</span>
                </div>
                <h3 className="text-lg font-bold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.text}</p>
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  );
}

function DashboardPreviewSection() {
  const metrics = [
    { label: "Today's income", value: "GHS 1,240", icon: TrendingUp, color: "text-primary" },
    { label: "Expenses", value: "GHS 380", icon: BarChart3, color: "text-secondary" },
    { label: "Stock items tracked", value: "12", icon: Package, color: "text-accent" },
    { label: "Outstanding debts", value: "GHS 650", icon: HandCoins, color: "text-amber-400" },
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 py-24">
      <div className="grid items-center gap-16 lg:grid-cols-2">
        <FadeUp>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <BarChart3 className="h-3 w-3" /> Live dashboard
          </div>
          <h2 className="text-4xl font-black leading-tight md:text-5xl">
            One screen.<br />Every number.
          </h2>
          <p className="mt-5 max-w-md text-muted-foreground leading-7">
            Your daily sales, expenses, profit, debt summary, stock alerts, and business health score — all updating live as you record. No manual calculation required.
          </p>
          <ul className="mt-8 space-y-3">
            {[
              "Profit vs expense breakdown for today",
              "Low-stock alerts before you run out",
              "Which customers owe you the most",
              "7-day sales trend chart",
            ].map((item) => (
              <li key={item} className="flex items-center gap-3 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                {item}
              </li>
            ))}
          </ul>
        </FadeUp>

        <FadeUp delay={0.15}>
          <GlassCard className="overflow-hidden">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-bold">Ama Stores — Today</p>
              <Badge variant="success">Healthy</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {metrics.map((m) => (
                <div key={m.label} className="rounded-2xl bg-white/[0.04] p-4">
                  <m.icon className={`h-4 w-4 ${m.color}`} />
                  <p className={`mt-3 text-xl font-black ${m.color}`}>{m.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{m.label}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-2xl bg-primary/10 p-4">
              <p className="text-xs font-semibold text-primary uppercase tracking-widest">Health score</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: "78%" }}
                  transition={{ duration: 1.2, delay: 0.6, ease: "easeOut" }}
                  className="h-full rounded-full bg-primary"
                />
              </div>
              <p className="mt-2 text-sm font-bold text-primary">78/100 — Very good! Keep it up 🌟</p>
            </div>
          </GlassCard>
        </FadeUp>
      </div>
    </section>
  );
}

// ── Pricing Section ────────────────────────────────────────────────────────────

function PricingSection() {
  const adminMomo = "0242176603";

  return (
    <section id="pricing" className="border-t border-white/[0.06] bg-white/[0.01]">
      <div className="mx-auto max-w-6xl px-4 py-24">
        {/* Header */}
        <FadeUp className="text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
            <BadgeCheck className="h-3 w-3" /> Transparent pricing
          </div>
          <h2 className="text-4xl font-black md:text-5xl">
            Start free. Scale as you grow.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Every plan includes our core AI memory engine. Paid plans unlock intelligence, automation, and strategic insight — not just more messages.
          </p>
          {/* Annual discount banner */}
          <div className="mx-auto mt-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-5 py-2 text-sm font-semibold text-emerald-400">
            <Sparkles className="h-4 w-4" />
            Pay annually and get 2 months free — save up to GHS 200/year
          </div>
        </FadeUp>

        {/* Tier cards */}
        <div className="mt-14 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {pricingTiers.map((tier, i) => (
            <FadeUp key={tier.id} delay={i * 0.08}>
              <div
                className={`relative flex h-full flex-col rounded-3xl border p-6 transition-all duration-300 hover:-translate-y-1 ${
                  tier.highlight
                    ? "border-emerald-500/40 bg-emerald-500/5 shadow-xl shadow-emerald-500/10"
                    : `${tier.borderColor} bg-white/[0.025]`
                } ${tier.glowColor ? `bg-gradient-to-b ${tier.glowColor} to-transparent` : ""}`}
              >
                {tier.highlight && (
                  <div className="pointer-events-none absolute inset-0 -z-10 rounded-3xl bg-emerald-500/5 blur-xl" />
                )}

                {/* Badge */}
                <div className="flex items-center justify-between">
                  <Badge variant={tier.badgeVariant} className="text-[10px]">
                    {tier.badge}
                  </Badge>
                  {tier.highlight && <Star className="h-4 w-4 fill-emerald-400 text-emerald-400" />}
                </div>

                {/* Name & tagline */}
                <h3 className={`mt-4 text-xl font-black ${tier.color}`}>{tier.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{tier.tagline}</p>

                {/* Price */}
                <div className="mt-5">
                  {tier.price === 0 ? (
                    <p className="text-4xl font-black">Free</p>
                  ) : (
                    <>
                      <p className="text-4xl font-black">
                        GHS {tier.price}
                        <span className="text-sm font-normal text-muted-foreground">/mo</span>
                      </p>
                      {tier.annualPrice && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          or GHS {tier.annualPrice}/year{" "}
                          <span className="text-emerald-400 font-medium">
                            (save GHS {tier.price * 2})
                          </span>
                        </p>
                      )}
                    </>
                  )}
                </div>

                {/* Target */}
                <p className="mt-3 text-[11px] text-muted-foreground leading-5 border-t border-white/[0.06] pt-3">
                  {tier.target}
                </p>

                {/* Limits */}
                <div className="mt-3 space-y-1.5">
                  {tier.limits.map((limit) => (
                    <div key={limit} className="flex items-center gap-2">
                      <Zap className={`h-3.5 w-3.5 shrink-0 ${tier.color}`} />
                      <span className="text-xs font-medium">{limit}</span>
                    </div>
                  ))}
                </div>

                {/* CTA */}
                <div className="mt-5">
                  <Button asChild variant={tier.ctaVariant} className="w-full">
                    <Link href="/login">{tier.cta} <ArrowRight className="ml-2 h-3.5 w-3.5" /></Link>
                  </Button>
                </div>

                {/* Features */}
                <ul className="mt-5 space-y-2.5 border-t border-white/[0.06] pt-5 flex-1">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <CheckCircle2 className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tier.color}`} />
                      <span className="text-xs leading-5 text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </FadeUp>
          ))}
        </div>

        {/* MoMo payment instructions */}
        <FadeUp delay={0.3} className="mt-12">
          <GlassCard className="text-center">
            <div className="mx-auto max-w-2xl">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10">
                <span className="text-2xl">📱</span>
              </div>
              <h3 className="text-xl font-black">Pay with Mobile Money</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                No card required. Pay directly with MoMo and get activated within 1 hour.
              </p>

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                {[
                  { network: "MTN MoMo", ussd: "*170#", step: "Send Money" },
                  { network: "AirtelTigo", ussd: "*110#", step: "Make Payment" },
                  { network: "Vodafone Cash", ussd: "*110#", step: "Send Money" },
                ].map((n) => (
                  <div key={n.network} className="rounded-2xl bg-white/[0.04] px-4 py-4 text-left">
                    <p className="font-bold text-sm">{n.network}</p>
                    <p className="mt-1 font-mono text-lg text-primary">{n.ussd}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      → {n.step} → {adminMomo}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-2xl bg-primary/5 border border-primary/10 px-5 py-4">
                <p className="text-sm text-muted-foreground leading-6">
                  After paying, open WhatsApp and message ZURIA:{" "}
                  <span className="font-mono font-bold text-foreground">PAID GROWTH</span>,{" "}
                  <span className="font-mono font-bold text-foreground">PAID PRO</span>, or{" "}
                  <span className="font-mono font-bold text-foreground">PAID ENTERPRISE</span>.
                  <br />We will verify and activate your plan within <strong>1 hour</strong>.
                </p>
              </div>
            </div>
          </GlassCard>
        </FadeUp>
      </div>
    </section>
  );
}

function BusinessTypesSection() {
  return (
    <section id="for-you" className="border-t border-white/[0.06] bg-white/[0.015]">
      <div className="mx-auto max-w-6xl px-4 py-24">
        <FadeUp>
          <h2 className="text-center text-4xl font-black md:text-5xl">Made for your business.</h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-muted-foreground">
            ZURIA speaks the language of Ghanaian traders, shopkeepers, service providers, and market vendors.
          </p>
        </FadeUp>

        <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {businessTypes.map((type, i) => (
            <FadeUp key={type.name} delay={i * 0.06}>
              <GlassCard className="group flex flex-col items-center gap-3 py-6 text-center hover:border-primary/20 transition-colors duration-300">
                <span className="text-4xl">{type.emoji}</span>
                <p className="text-sm font-semibold">{type.name}</p>
              </GlassCard>
            </FadeUp>
          ))}
        </div>

        <FadeUp delay={0.2} className="mt-8 text-center">
          <p className="text-sm text-muted-foreground">
            Don&apos;t see yours? ZURIA works for any business.{" "}
            <Link href="/login" className="text-primary underline underline-offset-4 hover:text-primary/80">
              Start free today.
            </Link>
          </p>
        </FadeUp>
      </div>
    </section>
  );
}

function CtaSection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24">
      <FadeUp>
        <GlassCard className="relative overflow-hidden text-center">
          {/* Glow */}
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute left-1/2 top-1/2 h-[500px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/8 blur-[80px]" />
          </div>

          <div className="mx-auto max-w-2xl py-8">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Ghana first. Built to scale across Africa.
            </span>
            <h2 className="mt-6 text-4xl font-black leading-tight md:text-5xl">
              Your shop&apos;s memory,<br />in your pocket.
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-muted-foreground leading-7">
              Join thousands of Ghanaian traders who record their business in seconds and always know exactly where their money stands.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button asChild size="default" className="gap-2 shadow-lg shadow-primary/25">
                <Link href="/login">
                  Start free — phone only <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="ghost" size="default">
                <Link href="#pricing">See all plans</Link>
              </Button>
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
              No credit card · No email · No training · Cancel anytime
            </p>
          </div>
        </GlassCard>
      </FadeUp>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-black text-primary-foreground">
              Z
            </span>
            <span className="text-sm font-bold tracking-[0.22em]">ZURIA</span>
          </div>
          <div className="flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
            <Link href="#features" className="hover:text-foreground transition-colors">Features</Link>
            <Link href="#how-it-works" className="hover:text-foreground transition-colors">How it works</Link>
            <Link href="#pricing" className="hover:text-foreground transition-colors">Pricing</Link>
            <Link href="#for-you" className="hover:text-foreground transition-colors">For your business</Link>
            <Link href="/login" className="hover:text-foreground transition-colors">Sign in</Link>
          </div>
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} ZURIA. Built for Ghana.</p>
        </div>
      </div>
    </footer>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function LandingPage() {
  return (
    <div className="min-h-screen">
      <NavBar />
      <HeroSection />
      <StatsBar />
      <FeaturesSection />
      <MoatSection />
      <HowItWorksSection />
      <DashboardPreviewSection />
      <PricingSection />
      <BusinessTypesSection />
      <CtaSection />
      <Footer />
    </div>
  );
}
