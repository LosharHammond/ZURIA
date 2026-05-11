"use client";

import { motion } from "framer-motion";
import {
  Banknote,
  Building2,
  CreditCard,
  Landmark,
  PackagePlus,
  PiggyBank,
  RefreshCcw,
  UserCheck,
  Wallet,
} from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";

interface FinanceBreakdownProps {
  stockCosts: number;
  salaryCosts: number;
  taxCosts: number;
  fixedCosts: number;
  borrowingsIn: number;
  borrowingsOut: number;
  loanRepaymentsOut: number;
  loanCollectionsIn: number;
  investmentsIn: number;
  withdrawalsOut: number;
  refundsIn: number;
  refundsOut: number;
  loansGiven: number;
  loansTaken: number;
}

export function FinanceBreakdown(props: FinanceBreakdownProps) {
  const rows = [
    props.stockCosts > 0 && { icon: PackagePlus, label: "Goods you bought today", value: props.stockCosts, type: "out" as const },
    props.salaryCosts > 0 && { icon: UserCheck, label: "Workers paid today", value: props.salaryCosts, type: "out" as const },
    props.taxCosts > 0 && { icon: Landmark, label: "Tax paid today", value: props.taxCosts, type: "out" as const },
    props.fixedCosts > 0 && { icon: Building2, label: "Regular bills paid", value: props.fixedCosts, type: "out" as const },
    props.borrowingsIn > 0 && { icon: PiggyBank, label: "Money you borrowed today", value: props.borrowingsIn, type: "in" as const },
    props.borrowingsOut > 0 && { icon: Wallet, label: "Money you gave out (loan)", value: props.borrowingsOut, type: "out" as const },
    props.loanRepaymentsOut > 0 && { icon: RefreshCcw, label: "Loan you paid back today", value: props.loanRepaymentsOut, type: "out" as const },
    props.loanCollectionsIn > 0 && { icon: RefreshCcw, label: "Loan money you collected", value: props.loanCollectionsIn, type: "in" as const },
    props.investmentsIn > 0 && { icon: Banknote, label: "Money put into business", value: props.investmentsIn, type: "in" as const },
    props.withdrawalsOut > 0 && { icon: Wallet, label: "Money you took out", value: props.withdrawalsOut, type: "out" as const },
    props.refundsIn > 0 && { icon: CreditCard, label: "Refund you received", value: props.refundsIn, type: "in" as const },
    props.refundsOut > 0 && { icon: CreditCard, label: "Refund you gave a customer", value: props.refundsOut, type: "out" as const },
  ].filter(Boolean) as { icon: React.ElementType; label: string; value: number; type: "in" | "out" }[];

  const outstanding = [
    props.loansTaken > 0 && { label: "You still owe (loans you took)", value: props.loansTaken, type: "liability" as const },
    props.loansGiven > 0 && { label: "Still owed to you (loans you gave)", value: props.loansGiven, type: "asset" as const },
  ].filter(Boolean) as { label: string; value: number; type: "liability" | "asset" }[];

  if (rows.length === 0 && outstanding.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
      <GlassCard>
        <h3 className="mb-4 font-black text-lg">More money details</h3>

        {rows.length > 0 && (
          <div className="space-y-2">
            {rows.map(({ icon: Icon, label, value, type }) => (
              <div key={label} className="flex items-center justify-between rounded-2xl bg-white/[0.05] px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="text-sm text-muted-foreground">{label}</span>
                </div>
                <span className={`text-sm font-bold ${type === "in" ? "text-emerald-400" : "text-rose-400"}`}>
                  {type === "in" ? "+" : "-"}{formatMoney(value)}
                </span>
              </div>
            ))}
          </div>
        )}

        {outstanding.length > 0 && (
          <div className="mt-4 border-t border-white/10 pt-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Money still owed</p>
            {outstanding.map(({ label, value, type }) => (
              <div key={label} className="flex items-center justify-between px-1">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className={`text-sm font-bold ${type === "asset" ? "text-sky-400" : "text-amber-400"}`}>
                  {formatMoney(value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </motion.div>
  );
}
