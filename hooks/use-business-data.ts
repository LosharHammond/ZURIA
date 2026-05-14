"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  aggregateTodayBreakdown,
  buildChartData,
  computeHealthScore,
  computeHealthScoreBreakdown,
  generateDailySummary,
  generateNotifications,
} from "@/lib/analytics/summary";
import { fetchDebts } from "@/lib/services/debt-service";
import { fetchInventory } from "@/lib/services/inventory-service";
import { fetchLoans } from "@/lib/services/loan-service";
import { fetchTransactions } from "@/lib/services/transaction-service";
import { useAppStore } from "@/stores/app-store";

export function useBusinessData() {
  const business = useAppStore((s) => s.business);
  const user = useAppStore((s) => s.user);
  const transactions = useAppStore((s) => s.transactions);
  const debts = useAppStore((s) => s.debts);
  const loans = useAppStore((s) => s.loans);
  const inventory = useAppStore((s) => s.inventory);
  const notifications = useAppStore((s) => s.notifications);
  const loading = useAppStore((s) => s.loading);
  const offline = useAppStore((s) => s.offline);
  const setTransactions = useAppStore((s) => s.setTransactions);
  const setDebts = useAppStore((s) => s.setDebts);
  const setLoans = useAppStore((s) => s.setLoans);
  const setInventory = useAppStore((s) => s.setInventory);
  const setNotifications = useAppStore((s) => s.setNotifications);
  const setLoading = useAppStore((s) => s.setLoading);

  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    setError(null);
    try {
      const [txns, dbts, invt, lns] = await Promise.all([
        fetchTransactions(business.id),
        fetchDebts(business.id),
        fetchInventory(business.id),
        fetchLoans(business.id),
      ]);
      setTransactions(txns);
      setDebts(dbts);
      setInventory(invt);
      setLoans(lns);
      setNotifications(generateNotifications({
        businessId: business.id,
        transactions: txns,
        debts: dbts,
        inventory: invt,
        loans: lns,
      }));
    } catch (err) {
      console.error("[useBusinessData] refresh failed:", err);
      setError(err instanceof Error ? err.message : "Failed to load business data.");
    } finally {
      // Always clear the loading state — even on error — so UI never freezes
      setLoading(false);
    }
  }, [business?.id, setDebts, setInventory, setLoading, setLoans, setNotifications, setTransactions]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ── Computed values — memoized to avoid re-running expensive analytics on ──
  // ── every render (e.g. when unrelated store slices change)               ──
  const summary = useMemo(
    () => generateDailySummary(transactions, user?.ownerName),
    [transactions, user?.ownerName],
  );

  const healthScore = useMemo(
    () => computeHealthScore(transactions, debts, loans),
    [transactions, debts, loans],
  );

  const healthScoreBreakdown = useMemo(
    () => computeHealthScoreBreakdown(transactions, debts, loans),
    [transactions, debts, loans],
  );

  const chartData = useMemo(() => buildChartData(transactions), [transactions]);

  const breakdown = useMemo(() => aggregateTodayBreakdown(transactions), [transactions]);

  const debtOwed = useMemo(
    () => debts.reduce((acc, d) => acc + d.outstandingAmount, 0),
    [debts],
  );

  const loansGiven = useMemo(
    () =>
      loans
        .filter((l) => l.direction === "given" && l.status === "open")
        .reduce((acc, l) => acc + l.outstandingAmount, 0),
    [loans],
  );

  const loansTaken = useMemo(
    () =>
      loans
        .filter((l) => l.direction === "taken" && l.status === "open")
        .reduce((acc, l) => acc + l.outstandingAmount, 0),
    [loans],
  );

  const netReceivables = debtOwed + loansGiven;
  const netLiabilities = loansTaken;

  return {
    user,
    business,
    transactions,
    debts,
    loans,
    inventory,
    notifications,
    loading,
    offline,
    error,
    refresh,
    summary,
    healthScore,
    healthScoreBreakdown,
    chartData,
    ...breakdown,
    netPosition: breakdown.moneyIn - breakdown.moneyOut,
    debtOwed,
    loansGiven,
    loansTaken,
    netReceivables,
    netLiabilities,
  };
}
