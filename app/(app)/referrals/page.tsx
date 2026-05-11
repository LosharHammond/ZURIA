"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownToLine, CheckCircle, Clock, Copy, Gift,
  MessageCircle, Sparkles, TrendingUp, Users, Zap,
  ShieldCheck, BarChart3, Smartphone, AlertCircle,
} from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAppStore } from "@/stores/app-store";
import { getReferralStats, REFERRAL_REWARD } from "@/lib/services/referral-service";
import { getUserWithdrawals, submitWithdrawal } from "@/lib/services/withdrawal-service";
import type { WithdrawalMethod, WithdrawalNetwork, WithdrawalRequest } from "@/types/domain";
import { formatMoney } from "@/lib/utils";

// ─── Pre-written shareable message ────────────────────────────────────────────

function buildShareMessage(link: string, ownerName: string): string {
  const firstName = ownerName.split(" ")[0];
  return [
    `🚨 Attention shop owners, traders & business people! 🚨`,
    ``,
    `My name is ${firstName}. I've been using something that is completely changing how I run my business — and I HAD to tell you about it.`,
    ``,
    `The problem most of us face:`,
    `❌ We forget sales at the end of the day`,
    `❌ We don't know exactly who owes us money`,
    `❌ We can't tell if we made profit or not`,
    `❌ Stock runs out without warning`,
    `❌ No receipts, no records — just memory`,
    ``,
    `The solution? 👇`,
    ``,
    `✨ *ZURIA — Your FREE Business Helper on WhatsApp* ✨`,
    ``,
    `ZURIA is like having a personal accountant in your pocket — available 24/7, right on WhatsApp. You just send a text like "Sold rice 120" and it records everything automatically!`,
    ``,
    `✅ Track every sale instantly`,
    `✅ Know who owes you & how much`,
    `✅ See your daily profit & loss`,
    `✅ Manage your stock levels`,
    `✅ Works on WhatsApp — no new app to learn`,
    `✅ 100% FREE to use`,
    ``,
    `It works for ALL businesses:`,
    `🏪 Provision stores | ✂️ Barbers & salons`,
    `🍽️ Food sellers & restaurants | 📱 MoMo agents`,
    `👗 Boutiques | 🛠️ Any small business`,
    ``,
    `I use it every day now and I can tell you — I finally know my numbers! My business feels organised for the first time. 💪`,
    ``,
    `Join FREE today — it takes less than 2 minutes to set up:`,
    `👉 ${link}`,
    ``,
    `Don't let another day pass without knowing your numbers. Your business deserves better! 🚀`,
  ].join("\n");
}

// ─── Problems ZURIA solves ─────────────────────────────────────────────────────

const PROBLEMS = [
  { icon: AlertCircle, problem: "Forgetting sales at end of day", fix: "Every sale recorded instantly on WhatsApp" },
  { icon: Users, problem: "Losing track of who owes you", fix: "Automatic debt tracking with customer names" },
  { icon: BarChart3, problem: "Not knowing your daily profit", fix: "Real-time summary — just type 'balance'" },
  { icon: Smartphone, problem: "Stock running out without warning", fix: "Low-stock alerts before you run empty" },
  { icon: ShieldCheck, problem: "No receipts or records to show", fix: "Full transaction history, always safe" },
];

// ─── ZURIA benefits ────────────────────────────────────────────────────────────

const BENEFITS = [
  { icon: Zap, label: "Works on WhatsApp", desc: "No new app to download or learn" },
  { icon: TrendingUp, label: "See your profit daily", desc: "Know your numbers every single day" },
  { icon: ShieldCheck, label: "PIN-protected & secure", desc: "Only you can access your business data" },
  { icon: Sparkles, label: "Free forever", desc: "No subscriptions, no hidden fees" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReferralsPage() {
  const { user } = useAppStore();
  const [stats, setStats] = useState({ balance: 0, count: 0, code: "" });
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [msgCopied, setMsgCopied] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [method, setMethod] = useState<WithdrawalMethod>("momo");
  const [network, setNetwork] = useState<WithdrawalNetwork>("MTN");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  async function load() {
    if (!user) return;
    setLoading(true);
    try {
      const [s, w] = await Promise.all([
        getReferralStats(user.id),
        getUserWithdrawals(user.id),
      ]);
      setStats(s);
      setWithdrawals(w);
    } catch (err) {
      console.error("[referrals] load failed:", err);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [user?.id]);

  const referralLink = typeof window !== "undefined"
    ? `${window.location.origin}/login?ref=${stats.code}`
    : `/login?ref=${stats.code}`;

  const shareMessage = user ? buildShareMessage(referralLink, user.ownerName) : "";
  const waShareUrl = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;

  function copyLink() {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function copyMessage() {
    navigator.clipboard.writeText(shareMessage);
    setMsgCopied(true);
    setTimeout(() => setMsgCopied(false), 2500);
  }

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSubmitError("");
    if (!accountNumber.trim() || !accountName.trim()) {
      setSubmitError("Fill in all account details.");
      return;
    }
    setSubmitting(true);
    try {
      await submitWithdrawal({
        userId: user.id,
        ownerName: user.ownerName,
        phoneNumber: user.phoneNumber,
        amount: stats.balance,
        method,
        accountNumber: accountNumber.trim(),
        accountName: accountName.trim(),
        network: method === "momo" ? network : undefined,
      });
      setShowForm(false);
      setAccountNumber("");
      setAccountName("");
      await load();
    } catch {
      setSubmitError("Failed to submit request. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const hasPendingWithdrawal = withdrawals.some((w) => w.status === "pending" || w.status === "processing");
  const canWithdraw = stats.balance > 0 && !hasPendingWithdrawal;

  if (!user) return null;

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div>
        <p className="text-sm text-primary">Earn while you help others</p>
        <h1 className="mt-1 text-3xl font-black">Refer &amp; Earn</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Earn <span className="font-bold text-primary">{formatMoney(REFERRAL_REWARD)}</span> for every friend who joins ZURIA. Share once, earn forever.
        </p>
      </div>

      {/* ── Earnings counter ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <GlassCard>
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
              <Gift className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="text-3xl font-black">{formatMoney(stats.balance)}</p>
              <p className="text-xs text-muted-foreground">Total earned</p>
            </div>
            <div className="ml-auto flex items-center gap-2 rounded-2xl bg-white/[0.04] px-3 py-2">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-sm font-bold">{stats.count}</span>
              <span className="text-xs text-muted-foreground">friend{stats.count !== 1 ? "s" : ""} joined</span>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* ── Problem/solution section ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}>
        <GlassCard>
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">Why your friends need ZURIA</p>
            <h2 className="text-lg font-black leading-snug">
              Most traders lose money because they don&apos;t track it. ZURIA fixes that.
            </h2>
          </div>
          <div className="space-y-3">
            {PROBLEMS.map(({ icon: Icon, problem, fix }) => (
              <div key={problem} className="flex gap-3 rounded-xl bg-white/[0.03] p-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-destructive/10">
                  <Icon className="h-4 w-4 text-destructive" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-destructive/90 line-through">{problem}</p>
                  <p className="text-sm text-primary font-medium">✓ {fix}</p>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </motion.div>

      {/* ── Why ZURIA is amazing ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
        <GlassCard>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-3">What makes ZURIA special</p>
          <div className="grid grid-cols-2 gap-3">
            {BENEFITS.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex flex-col gap-1.5 rounded-xl bg-white/[0.03] p-3">
                <Icon className="h-5 w-5 text-primary" />
                <p className="text-sm font-bold leading-tight">{label}</p>
                <p className="text-xs text-muted-foreground leading-snug">{desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-center">
            <p className="text-sm font-bold text-primary">100% Free · Works on WhatsApp · No app to download</p>
            <p className="text-xs text-muted-foreground mt-0.5">Used by provision stores, barbers, food sellers & MoMo agents across Ghana</p>
          </div>
        </GlassCard>
      </motion.div>

      {/* ── Ready-to-send message ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.15 }}>
        <GlassCard>
          <div className="mb-3 flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-[#25D366]" />
            <h2 className="font-bold">Ready-to-send message</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Copy this message and send it to your friends on WhatsApp, Facebook, or any group. Your referral link is already included!
          </p>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading your message…</p>
          ) : (
            <>
              {/* Preview of the message */}
              <div className="mb-3 max-h-52 overflow-y-auto rounded-xl bg-[#25D366]/5 border border-[#25D366]/20 p-3">
                <pre className="whitespace-pre-wrap text-xs leading-5 text-foreground/80 font-sans">{shareMessage}</pre>
              </div>

              <div className="flex gap-2">
                {/* Copy message */}
                <Button
                  variant="outline"
                  className="flex-1 gap-2"
                  onClick={copyMessage}
                >
                  {msgCopied
                    ? <><CheckCircle className="h-4 w-4 text-green-400" /> Copied!</>
                    : <><Copy className="h-4 w-4" /> Copy message</>}
                </Button>

                {/* Share directly on WhatsApp */}
                <a
                  href={waShareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#25D366]/15 px-4 py-2.5 text-sm font-semibold text-[#25D366] transition-all hover:bg-[#25D366]/25 active:scale-95"
                >
                  <MessageCircle className="h-4 w-4" />
                  Share on WhatsApp
                </a>
              </div>
            </>
          )}
        </GlassCard>
      </motion.div>

      {/* ── Referral link (for manual sharing) ── */}
      <GlassCard>
        <h2 className="mb-1 font-bold">Your referral link</h2>
        <p className="text-xs text-muted-foreground mb-3">Share this link anywhere — social media, SMS, anywhere.</p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex gap-2">
              <Input value={referralLink} readOnly className="text-xs" />
              <Button variant="outline" size="sm" onClick={copyLink} className="shrink-0">
                {copied ? <CheckCircle className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Your code: <span className="font-bold text-primary">{stats.code}</span>
            </p>
          </>
        )}
      </GlassCard>

      {/* ── How it works ── */}
      <GlassCard>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-3">How it works</p>
        <div className="space-y-3">
          {[
            { step: "1", title: "Share your link or message", desc: "Send it to friends, family, group chats — anywhere" },
            { step: "2", title: "They sign up for free", desc: "Takes less than 2 minutes. No payment needed" },
            { step: "3", title: `You earn ${formatMoney(REFERRAL_REWARD)}`, desc: "Credited to your balance immediately they join" },
          ].map(({ step, title, desc }) => (
            <div key={step} className="flex gap-3 items-start">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-black text-primary">
                {step}
              </div>
              <div>
                <p className="text-sm font-semibold">{title}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* ── Withdraw earnings ── */}
      <GlassCard>
        <h2 className="mb-3 font-bold">Withdraw earnings</h2>

        {hasPendingWithdrawal && (
          <div className="flex items-center gap-2 text-sm text-amber-400 mb-3">
            <Clock className="h-4 w-4" />
            <span>Your withdrawal is being processed. We will send it to you very soon!</span>
          </div>
        )}

        {!canWithdraw && !hasPendingWithdrawal && stats.balance === 0 && (
          <p className="text-sm text-muted-foreground">
            No earnings yet. Share your message above and earn {formatMoney(REFERRAL_REWARD)} for every friend who joins!
          </p>
        )}

        {canWithdraw && !showForm && (
          <Button onClick={() => setShowForm(true)} className="w-full">
            <ArrowDownToLine className="mr-2 h-4 w-4" />
            Withdraw {formatMoney(stats.balance)}
          </Button>
        )}

        {showForm && (
          <form className="space-y-3" onSubmit={handleWithdraw}>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Payment method</p>
              <Select value={method} onChange={(e) => setMethod(e.target.value as WithdrawalMethod)}>
                <option value="momo">Mobile Money (MoMo) — instant</option>
                <option value="bank">Bank Account — 1–2 working days</option>
              </Select>
            </div>

            {method === "momo" && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Network</p>
                <Select value={network} onChange={(e) => setNetwork(e.target.value as WithdrawalNetwork)}>
                  <option value="MTN">MTN MoMo</option>
                  <option value="Vodafone">Vodafone Cash</option>
                  <option value="AirtelTigo">AirtelTigo Money</option>
                </Select>
              </div>
            )}

            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {method === "momo" ? "MoMo number" : "Account number"}
              </p>
              <Input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder={method === "momo" ? "0241234567" : "Bank account number"}
                inputMode="tel"
              />
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {method === "momo" ? "Name on MoMo" : "Account name"}
              </p>
              <Input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Full name on account"
              />
            </div>

            {submitError && <p className="text-xs text-destructive">{submitError}</p>}

            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={submitting}>
                {submitting ? "Submitting…" : `Request ${formatMoney(stats.balance)}`}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </form>
        )}
      </GlassCard>

      {/* ── Withdrawal history ── */}
      {withdrawals.length > 0 && (
        <GlassCard>
          <h2 className="mb-3 font-bold">Withdrawal history</h2>
          <div className="space-y-2">
            {withdrawals.map((w) => (
              <div key={w.id} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2">
                <div>
                  <p className="text-sm font-semibold">{formatMoney(w.amount)}</p>
                  <p className="text-xs text-muted-foreground">
                    {w.method === "momo" ? `${w.network} · ${w.accountNumber}` : `Bank · ${w.accountNumber}`}
                  </p>
                </div>
                <span className={`text-xs font-semibold ${
                  w.status === "approved" ? "text-green-400" :
                  w.status === "failed" || w.status === "rejected" ? "text-destructive" :
                  "text-amber-400"
                }`}>
                  {w.status === "processing" ? "Sending…" :
                   w.status === "approved" ? "Paid ✓" :
                   w.status === "failed" ? "Failed" :
                   w.status === "rejected" ? "Rejected" : "Pending"}
                </span>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
