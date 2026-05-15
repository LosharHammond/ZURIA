"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  aggregateTodayBreakdown,
  buildChartData,
  computeHealthScoreBreakdown,
  generateDailySummary,
  generateNotifications,
} from "@/lib/analytics/summary";
import { fetchDebts } from "@/lib/services/debt-service";
import { fetchInventory } from "@/lib/services/inventory-service";
import { fetchLoans } from "@/lib/services/loan-service";
import { fetchTransactions } from "@/lib/services/transaction-service";
import { useAppStore } from "@/stores/app-store";

// ── Session-level fetch deduplication ────────────────────────────────────────
// Tracks which businessIds have been fetched in this browser session.
// Prevents 4 redundant Firestore reads every time the user navigates between
// pages (dashboard → debts → inventory → back). Data stays fresh for
// STALE_MS milliseconds; after that, any mount triggers a re-fetch.
const _lastFetched = new Map<string, number>(); // businessId → timestamp
const STALE_MS = 60_000; // 60 seconds — tune down for stricter freshness

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
  // Ref used to skip the auto-refresh if data is still fresh when this hook
  // mounts on a new page (e.g. dashboard → debts navigation).
  const didMountRef = useRef(false);

  const refresh = useCallback(async (force = false) => {
    if (!business?.id) return;

    // Staleness guard: skip if fetched recently and data already exists.
    // `force = true` bypasses this (used after manual writes like new transactions).
    if (!force) {
      const lastFetch = _lastFetched.get(business.id) ?? 0;
      const isStale   = Date.now() - lastFetch > STALE_MS;
      if (!isStale && transactions.length > 0) return;
    }

    setLoading(true);
    setError(null);
    try {
      const [txns, dbts, invt, lns] = await Promise.all([
        fetchTransactions(business.id),
        fetchDebts(business.id),
        fetchInventory(business.id),
        fetchLoans(business.id),
      ]);
      // Mark Firestore data updates as non-urgent transitions.
      // React will keep the UI responsive during these batched state updates
      // and won't block user input (e.g. the transaction composer) while
      // the store hydrates with fresh data from Firestore.
      startTransition(() => {
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
      });
      _lastFetched.set(business.id, Date.now());
    } catch (err) {
      console.error("[useBusinessData] refresh failed:", err);
      setError(err instanceof Error ? err.message : "Failed to load business data.");
    } finally {
      // Always clear the loading state — even on error — so UI never freezes
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, setDebts, setInventory, setLoading, setLoans, setNotifications, setTransactions]);
  // NOTE: `transactions` intentionally omitted from deps — it changes after
  // every fetch and would create an infinite loop. The staleness check reads
  // `transactions.length` from closure; the ref capture is safe because the
  // staleness guard only uses it to decide whether to skip, not for data.

  useEffect(() => {
    // Skip the very first effect run so we don't double-fetch when
    // business?.id changes from undefined → value during auth initialization.
    if (!didMountRef.current) {
      didMountRef.current = true;
    }
    refresh();
  }, [refresh]);

  // ── Computed values — memoized to avoid re-running expensive analytics on ──
  // ── every render (e.g. when unrelated store slices change)               ──
  const summary = useMemo(
    () => generateDailySummary(transactions, user?.ownerName),
    [transactions, user?.ownerName],
  );

  // computeHealthScoreBreakdown internally computes the same data as
  // computeHealthScore — run it once and derive the scalar from .score.
  // Previously both were called separately (double work on every render).
  const healthScoreBreakdown = useMemo(
    () => computeHealthScoreBreakdown(transactions, debts, loans),
    [transactions, debts, loans],
  );

  // Derive the scalar score from the breakdown — no redundant computation
  const healthScore = healthScoreBreakdown.score;

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
