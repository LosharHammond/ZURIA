"use client";

import { create } from "zustand";
import type { AppUser, Business, Debt, InventoryItem, Loan, SmartNotification, Transaction } from "@/types/domain";

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
  setDebts: (debts: Debt[]) => void;
  setLoans: (loans: Loan[]) => void;
  setInventory: (inventory: InventoryItem[]) => void;
  setNotifications: (notifications: SmartNotification[]) => void;
  setOffline: (offline: boolean) => void;
  setLoading: (loading: boolean) => void;
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
  setDebts: (debts) => set({ debts }),
  setLoans: (loans) => set({ loans }),
  setInventory: (inventory) => set({ inventory }),
  setNotifications: (notifications) => set({ notifications }),
  setOffline: (offline) => set({ offline }),
  setLoading: (loading) => set({ loading }),
}));
