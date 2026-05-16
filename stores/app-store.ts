"use client";

import { create } from "zustand";
import type { AppUser, Business, Debt, InventoryItem, Loan, SmartNotification, SubscriptionPlan, Transaction } from "@/types/domain";

interface AppState {
  user?: AppUser;
  business?: Business;
  transactions: Transaction[];
  debts: Debt[];
  loans: Loan[];
  inventory: InventoryItem[];
  notifications: SmartNotification[];
  offline: boolean;
  loading: boolean;
  setUser: (user?: AppUser) => void;
  setBusiness: (business?: Business) => void;
  setTransactions: (transactions: Transaction[]) => void;
  addTransaction: (transaction: Transaction) => void;
  removeTransaction: (id: string) => void;
  setDebts: (debts: Debt[]) => void;
  setLoans: (loans: Loan[]) => void;
  setInventory: (inventory: InventoryItem[]) => void;
  setNotifications: (notifications: SmartNotification[]) => void;
  setOffline: (offline: boolean) => void;
  setLoading: (loading: boolean) => void;
  /**
   * Surgically update subscription fields on the user record after a successful
   * payment — avoids a full Firestore re-fetch or auth cycle just to refresh plan.
   */
  updateUserSubscription: (plan: SubscriptionPlan, expiresAt: string | null) => void;
  /** Call on logout — clears all user-scoped data so stale records never leak to the next session. */
  clearUserData: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  transactions: [],
  debts: [],
  loans: [],
  inventory: [],
  notifications: [],
  offline: false,
  loading: true,
  setUser: (user) => set({ user }),
  setBusiness: (business) => set({ business }),
  setTransactions: (transactions) => set({ transactions }),
  addTransaction: (transaction) => set((state) => ({ transactions: [transaction, ...state.transactions] })),
  removeTransaction: (id) => set((state) => ({ transactions: state.transactions.filter((t) => t.id !== id) })),
  setDebts: (debts) => set({ debts }),
  setLoans: (loans) => set({ loans }),
  setInventory: (inventory) => set({ inventory }),
  setNotifications: (notifications) => set({ notifications }),
  setOffline: (offline) => set({ offline }),
  setLoading: (loading) => set({ loading }),
  updateUserSubscription: (plan, expiresAt) =>
    set((state) =>
      state.user
        ? {
            user: {
              ...state.user,
              subscriptionPlan: plan,
              subscriptionExpiresAt: expiresAt,
              whatsappMessageCount: 0,
            },
          }
        : {}
    ),
  clearUserData: () =>
    set({
      user: undefined,
      business: undefined,
      transactions: [],
      debts: [],
      loans: [],
      inventory: [],
      notifications: [],
      loading: false,
    }),
}));
