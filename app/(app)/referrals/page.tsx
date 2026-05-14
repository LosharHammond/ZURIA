"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownToLine, CheckCircle, Clock, Copy, Gift,
  MessageCircle, Sparkles, TrendingUp, Users, Zap,
  ShieldCheck, BarChart3, Smartphone, AlertCircle, Star,
  Lock,
} from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAppStore } from "@/stores/app-store";
import { useAuth } from "@/providers/auth-provider";
import {
  getReferralStats,
  REFERRAL_REWARD,
  WITHDRAWAL_THRESHOLD,
  MILESTONE_REFERRALS,
  MILESTONE_BALANCE,
  type ReferralStats,
} from "@/lib/services/referral-service";
import { getUserWithdrawals } from "@/lib/services/withdrawal-service";
import type { WithdrawalNetwork, WithdrawalRequest } from "@/types/domain";
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

// ─── Dual-milestone progress bar ──────────────────────────────────────────────

function MilestoneProgress({ balance, monthlyCount }: { balance: number; monthlyCount: number }) {
  const milestonePct = Math.min(100, (balance / MILESTONE_BALANCE) * 100);
  const monthlyPct = Math.min(100, (monthlyCount / MILESTONE_REFERRALS) * 100);

  const canWithdraw = balance >= WITHDRAWAL_THRESHOLD;
  const hitMilestone = balance >= MILESTONE_BALANCE;

  return (
    <div className="space-y-4">
      {/* Cash balance progress */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-muted-foreground">Cash earnings</span>
          <span className="text-xs font-bold text-foreground">{formatMoney(balance)}</span>
        </div>
        {/* Two-marker progress bar */}
        <div className="relative h-3 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${
              hitMilestone ? "bg-amber-400" : canWithdraw ? "bg-emerald-500" : "bg-primary"
            }`}
            style={{ width: `${hitMilestone ? 100 : milestonePct}%` }}
          />
          {/* GHS 5 marker */}
          <div
            className="absolute inset-y-0 w-0.5 bg-white/40"
            style={{ left: `${(WITHDRAWAL_THRESHOLD / MILESTONE_BALANCE) * 100}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className={`text-[10px] font-semibold ${canWithdraw ? "text-emerald-400" : "text-muted-foreground"}`}>
            {canWithdraw ? "✅ GHS 5 — can withdraw" : `GHS 5 withdraw (${10 - Math.ceil(balance / REFERRAL_REWARD)} more)`}
          </span>
          <span className={`text-[10px] font-semibold ${hitMilestone ? "text-amber-400" : "text-muted-foreground"}`}>
            {hitMilestone ? "🏆 GHS 15 — milestone hit!" : `GHS 15 milestone (${MILESTONE_REFERRALS - Math.ceil(balance / REFERRAL_REWARD)} more)`}
          </span>
        </div>
      </div>

      {/* Monthly referral progress toward Growth unlock */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-muted-foreground">Monthly referrals (this month)</span>
          <span className="text-xs font-bold text-foreground">{monthlyCount} / {MILESTONE_REFERRALS}</span>
        </div>
        <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              monthlyCount >= MILESTONE_REFERRALS ? "bg-amber-400" : "bg-indigo-500"
            }`}
            style={{ width: `${monthlyPct}%` }}
          />
        </div>
        {monthlyCount >= MILESTONE_REFERRALS ? (
          <p className="mt-1 text-[10px] font-bold text-amber-400">🏆 30 referrals this month — Growth features unlocked!</p>
        ) : (
          <p className="mt-1 text-[10px] text-muted-foreground">
            {MILESTONE_REFERRALS - monthlyCount} more this month → unlock Growth features FREE 🚀
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Smart earnings card ───────────────────────────────────────────────────────

function EarningsChoiceCard({ balance, monthlyCount, onWithdrawClick }: {
  balance: number;
  monthlyCount: number;
  onWithdrawClick: () => void;
}) {
  const canWithdraw = balance >= WITHDRAWAL_THRESHOLD;
  const hitMilestone = balance >= MILESTONE_BALANCE;
  const remainingToMilestone = parseFloat((MILESTONE_BALANCE - balance).toFixed(2));
  const referralsToMilestone = Math.ceil(remainingToMilestone / REFERRAL_REWARD);
  const referralsToWithdraw = Math.max(0, Math.ceil((WITHDRAWAL_THRESHOLD - balance) / REFERRAL_REWARD));

  if (hitMilestone) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Star className="h-5 w-5 text-amber-400 fill-amber-400" />
          <p className="font-bold text-amber-300">You&apos;ve hit the GHS 15 milestone!</p>
        </div>
        <p className="text-sm text-muted-foreground leading-5">
          You referred {Math.floor(balance / REFERRAL_REWARD)}+ friends and earned{" "}
          <span className="font-bold text-amber-300">{formatMoney(balance)}</span>!{" "}
          Growth features are unlocked for you this month as a thank-you. 🎁
        </p>
        <Button onClick={onWithdrawClick} className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold">
          <ArrowDownToLine className="mr-2 h-4 w-4" />
          Withdraw {formatMoney(balance)}
        </Button>
      </div>
    );
  }

  if (canWithdraw) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4">
          <p className="font-bold text-emerald-300 mb-1">💰 You can withdraw {formatMoney(balance)} now!</p>
          <p className="text-sm text-muted-foreground leading-5">
            <span className="font-semibold text-foreground">Or</span> — hold on for just{" "}
            <span className="font-bold text-amber-300">{referralsToMilestone} more referral{referralsToMilestone !== 1 ? "s" : ""}</span>{" "}
            and you&apos;ll earn <span className="font-bold text-amber-300">{formatMoney(MILESTONE_BALANCE)}</span> total
            {" "}+ unlock <span className="font-bold text-indigo-300">ZURIA Growth features FREE</span> for the rest of the month! 🚀
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={onWithdrawClick} variant="outline" className="w-full">
            <ArrowDownToLine className="mr-2 h-4 w-4" />
            Withdraw now
          </Button>
          <div className="flex items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-center">
            <div>
              <p className="text-[10px] font-bold text-amber-300">Hold for milestone</p>
              <p className="text-[10px] text-muted-foreground">{referralsToMilestone} more = GHS 15 + Growth</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Can't withdraw yet
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {balance === 0
            ? `Share your link and earn ${formatMoney(REFERRAL_REWARD)} for every friend who joins!`
            : `You have ${formatMoney(balance)} — ${referralsToWithdraw} more referral${referralsToWithdraw !== 1 ? "s" : ""} to reach the ${formatMoney(WITHDRAWAL_THRESHOLD)} withdrawal minimum.`}
        </p>
        {balance > 0 && (
          <div className="mt-2 h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, (balance / WITHDRAWAL_THRESHOLD) * 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* Strategy tip */}
      <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-3">
        <p className="text-xs font-bold text-indigo-300 mb-1">🎯 Pro tip: aim for the big milestone</p>
        <p className="text-xs text-muted-foreground leading-4">
          Refer just <span className="font-bold text-foreground">{Math.max(0, MILESTONE_REFERRALS - monthlyCount)} more people this month</span>{" "}
          and you&apos;ll earn <span className="font-bold text-amber-300">{formatMoney(MILESTONE_BALANCE)}</span> total
          {" "}+ unlock <span className="font-bold text-indigo-300">ZURIA Growth features FREE</span> for the whole month —
          worth <span className="font-bold text-foreground">GHS 20</span>!
        </p>
      </div>

      <Button disabled className="w-full opacity-50 cursor-not-allowed">
        <Lock className="mr-2 h-4 w-4" />
        Withdraw (need {formatMoney(WITHDRAWAL_THRESHOLD)} min)
      </Button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReferralsPage() {
  const { user } = useAppStore();
  const { firebaseUser } = useAuth();
  const [stats, setStats] = useState<ReferralStats>({
    balance: 0, count: 0, code: "", monthlyCount: 0, referralUnlockExpiresAt: null,
  });
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [msgCopied, setMsgCopied] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [network, setNetwork] = useState<WithdrawalNetwork>("MTN");
  const [momoNumber, setMomoNumber] = useState("");
  const [momoName, setMomoName] = useState("");
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
    ? `${window.location.origin}/?ref=${stats.code}`
    : `/?ref=${stats.code}`;

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
    if (!user || !firebaseUser) return;
    setSubmitError("");
    if (!momoNumber.trim() || !momoName.trim()) {
      setSubmitError("Enter your MoMo number and the name on the account.");
      return;
    }
    if (stats.balance < WITHDRAWAL_THRESHOLD) {
      setSubmitError(`You need at least ${formatMoney(WITHDRAWAL_THRESHOLD)} to withdraw. Your balance is ${formatMoney(stats.balance)}.`);
      return;
    }
    setSubmitting(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/referral/withdraw", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ momoNumber: momoNumber.trim(), momoName: momoName.trim(), network }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Failed to submit request. Try again.");
        return;
      }
      setShowForm(false);
      setMomoNumber("");
      setMomoName("");
      await load();
    } catch {
      setSubmitError("Failed to submit request. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const hasPendingWithdrawal = withdrawals.some((w) => w.status === "pending" || w.status === "processing");

  if (!user) return null;

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div>
        <p className="text-sm text-primary">Earn while you help others</p>
        <h1 className="mt-1 text-3xl font-black">Refer &amp; Earn</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Earn <span className="font-bold text-primary">{formatMoney(REFERRAL_REWARD)}</span> for every friend who joins ZURIA.
          Reach <span className="font-bold text-amber-400">30 referrals</span> this month and unlock <span className="font-bold text-indigo-300">Growth features FREE!</span>
        </p>
      </div>

      {/* ── Earnings counter + milestone progress ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <GlassCard>
          <div className="flex items-center gap-4 mb-4">
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
              <span className="text-xs text-muted-foreground">joined</span>
            </div>
          </div>

          {!loading && (
            <MilestoneProgress balance={stats.balance} monthlyCount={stats.monthlyCount} />
          )}
        </GlassCard>
      </motion.div>

      {/* ── Two-milestone explainer ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}>
        <GlassCard>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-3">Two ways to win</p>
          <div className="space-y-3">
            {/* Goal 1: GHS 5 */}
            <div className="flex gap-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-base font-black text-emerald-400">
                1
              </div>
              <div>
                <p className="text-sm font-bold text-emerald-300">Earn GHS 5 → Withdraw cash 💵</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-4">
                  Just <span className="font-semibold text-foreground">10 referrals</span> to reach the minimum.
                  Request a MoMo payout any time after that — processed within 24 hours.
                </p>
              </div>
            </div>

            {/* Goal 2: GHS 15 / 30 referrals */}
            <div className="flex gap-3 rounded-xl bg-amber-500/5 border border-amber-500/20 p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-base font-black text-amber-400">
                2
              </div>
              <div>
                <p className="text-sm font-bold text-amber-300">30 referrals → GHS 15 + Growth FREE 🚀</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-4">
                  Hold until you refer <span className="font-semibold text-foreground">30 people this month</span> and you earn{" "}
                  <span className="font-bold text-amber-300">GHS 15.00</span> cash{" "}
                  <span className="font-bold">AND</span> unlock{" "}
                  <span className="font-bold text-indigo-300">ZURIA Growth features free</span> until end of month —
                  monthly reports, AI insights, debt reminders, inventory alerts. Worth GHS 20!
                </p>
              </div>
            </div>

            <p className="text-xs text-center text-muted-foreground pt-1">
              You can choose either path — or go for both! 🎯
            </p>
          </div>
        </GlassCard>
      </motion.div>

      {/* ── Problem/solution section ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.08 }}>
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
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.12 }}>
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
              <div className="mb-3 max-h-52 overflow-y-auto rounded-xl bg-[#25D366]/5 border border-[#25D366]/20 p-3">
                <pre className="whitespace-pre-wrap text-xs leading-5 text-foreground/80 font-sans">{shareMessage}</pre>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-2" onClick={copyMessage}>
                  {msgCopied
                    ? <><CheckCircle className="h-4 w-4 text-green-400" /> Copied!</>
                    : <><Copy className="h-4 w-4" /> Copy message</>}
                </Button>
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
              <Button variant="outline" size="sm" onClick={copyLink} className="shrink-0" aria-label="Copy referral link">
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
            { step: "3", title: `You earn ${formatMoney(REFERRAL_REWARD)}`, desc: "Credited to your balance the moment they join" },
            { step: "4", title: "Cash out or keep growing", desc: `Withdraw at GHS 5+, or hold for 30 referrals = GHS 15 + Growth features FREE` },
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
            <Clock className="h-4 w-4 shrink-0" />
            <span>Your withdrawal is being processed — we&apos;ll send it to you very soon!</span>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !hasPendingWithdrawal && !showForm ? (
          <EarningsChoiceCard
            balance={stats.balance}
            monthlyCount={stats.monthlyCount}
            onWithdrawClick={() => setShowForm(true)}
          />
        ) : null}

        {showForm && (
          <form className="space-y-3" onSubmit={handleWithdraw}>
            <div className="rounded-xl bg-primary/5 border border-primary/15 px-3 py-2.5">
              <p className="text-xs text-muted-foreground">Withdrawal amount</p>
              <p className="text-lg font-black text-primary">{formatMoney(stats.balance)}</p>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">MoMo network</p>
              <Select value={network} onChange={(e) => setNetwork(e.target.value as WithdrawalNetwork)}>
                <option value="MTN">MTN MoMo</option>
                <option value="Vodafone">Vodafone Cash</option>
                <option value="AirtelTigo">AirtelTigo Money</option>
                <option value="Telecel">Telecel Money</option>
              </Select>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">MoMo number</p>
              <Input
                value={momoNumber}
                onChange={(e) => setMomoNumber(e.target.value)}
                placeholder="0241234567"
                inputMode="tel"
              />
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Name on MoMo account</p>
              <Input
                value={momoName}
                onChange={(e) => setMomoName(e.target.value)}
                placeholder="Full name as registered on MoMo"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Money will be sent within 24 hours. You will receive a WhatsApp confirmation.
            </p>

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
