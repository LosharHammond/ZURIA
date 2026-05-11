"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useTransactionEntry } from "@/hooks/use-transaction-entry";
import { useAppStore } from "@/stores/app-store";
import { formatMoney } from "@/lib/utils";
import { MONEY_IN_TYPES, TRANSACTION_TYPE_LABELS } from "@/types/domain";
import type { BusinessCategory } from "@/types/domain";

// ─── Business-aware example hints ─────────────────────────────────────────────

function getHints(category?: BusinessCategory): string[] {
  switch (category) {
    case "barber":
    case "salon":
      return ["Cut hair 15", "Shave 20", "Braiding 80", "Ama owes me 50", "Bought clippers 200", "Paid rent 300", "Salary Adjoa 400", "Kojo paid 50"];
    case "food":
    case "restaurant":
      return ["Sold rice 10", "5 plates fufu 50", "Ama owes me 30", "Kojo paid 30", "Bought tomatoes 80", "Paid gas 50", "Salary Adjoa 400", "Bought cooking oil 200"];
    case "momo":
      return ["Sent 200 momo", "Received 100", "Float charges 5", "Ama owes me 50", "Bought float 500", "Paid ECG 50"];
    case "pharmacy":
      return ["Sold paracetamol 5", "Sold malaria drugs 20", "Ama owes me 100", "Bought stock 500", "Kojo paid 100", "Paid rent 400"];
    case "spare-parts":
    case "hardware":
      return ["Sold oil filter 80", "Sold cement 30", "Ama owes me 200", "Bought stock 1000", "Kojo paid 200", "Paid rent 500"];
    default:
      return ["Sold rice 120", "Ama owes me 200", "Kojo paid 70", "Bought stock 800", "Paid ECG 50", "Salary Kofi 500", "Tax 200", "Borrowed 1000 from Barclays"];
  }
}

function getPlaceholder(category?: BusinessCategory): string {
  switch (category) {
    case "barber": case "salon":   return '"Cut hair 15" or "Ama owes me 50" or "Paid rent 300"…';
    case "food": case "restaurant": return '"Sold rice 10" or "Ama owes me 30" or "Paid gas 50"…';
    case "momo":                    return '"Sent 200 momo" or "Received 100" or "Float 500"…';
    default:                        return '"Sold rice 120" or "Ama owes me 200" or "Paid ECG 50"…';
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  initialText?: string;
  onInitialUsed?: () => void;
}

export function TransactionComposer({ initialText, onInitialUsed }: Props) {
  const { text, setText, parsed, saving, error, submit } = useTransactionEntry();
  const category = useAppStore((s) => s.business?.category);
  const hints = getHints(category);

  // Sync external prefill (from quick action buttons on dashboard)
  useEffect(() => {
    if (initialText) {
      setText(initialText);
      onInitialUsed?.();
    }
  }, [initialText]); // eslint-disable-line

  const typeLabel = parsed ? (TRANSACTION_TYPE_LABELS[parsed.type] ?? parsed.type.replace(/_/g, " ")) : null;
  const isIn      = parsed ? MONEY_IN_TYPES.includes(parsed.type) : false;
  const isNeutral = parsed?.type === "debt" || parsed?.type === "transfer";
  const amountColor = isNeutral ? "" : isIn ? "text-emerald-400 font-bold" : "text-rose-400 font-bold";

  const counterpartyLabel: Partial<Record<string, string>> = {
    borrow_in: "From", borrow_out: "To", loan_repay_out: "To", loan_collect_in: "From",
    salary: "Worker", debt: "Customer", repayment: "Customer", refund_out: "Customer", refund_in: "From",
  };
  const personLabel = parsed ? (counterpartyLabel[parsed.type] ?? "Person") : "Person";

  const productWord = (category === "barber" || category === "salon") ? "Service"
    : (category === "food" || category === "restaurant") ? "Item"
    : "Item";

  return (
    <GlassCard>
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="font-bold leading-tight">What happened today?</p>
          <p className="text-xs text-muted-foreground">Just type — ZURIA will understand. 😊</p>
        </div>
      </div>

      {/* Quick hint chips — always visible, tap to fill */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {hints.map((hint) => (
          <button
            key={hint}
            type="button"
            onClick={() => setText(hint)}
            className="rounded-full bg-white/[0.06] px-3 py-1 text-xs text-muted-foreground hover:bg-white/[0.12] hover:text-foreground transition-colors active:scale-95"
          >
            {hint}
          </button>
        ))}
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={getPlaceholder(category)}
        rows={2}
        className="text-base"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && parsed && parsed.amount > 0) {
            e.preventDefault();
            submit();
          }
        }}
      />

      {/* Live preview */}
      <AnimatePresence>
        {parsed && parsed.amount > 0 && (
          <motion.div
            key="preview"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-white/[0.06] px-4 py-3"
          >
            <span className="text-xs text-muted-foreground">{typeLabel}</span>
            <span className={`text-sm ${amountColor}`}>{formatMoney(parsed.amount)}</span>
            {parsed.productName && (
              <span className="text-xs text-muted-foreground">{productWord}: <span className="text-foreground">{parsed.productName}</span></span>
            )}
            {parsed.customerName && (
              <span className="text-xs text-muted-foreground">{personLabel}: <span className="text-foreground">{parsed.customerName}</span></span>
            )}
            {parsed.confidence < 0.55 && (
              <span className="text-xs text-amber-400">⚠ Check this</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <p className="mt-2 text-xs text-rose-400">⚠ {error}</p>
      )}

      <Button
        className="mt-3 w-full"
        onClick={submit}
        disabled={!parsed || parsed.amount <= 0 || saving}
      >
        {saving ? "Saving…" : "Save"} <Send className="ml-2 h-4 w-4" />
      </Button>
    </GlassCard>
  );
}
