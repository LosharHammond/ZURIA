"use client";

import { AuthProvider } from "@/providers/auth-provider";
import { SyncProvider } from "@/providers/sync-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SyncProvider>{children}</SyncProvider>
    </AuthProvider>
  );
}
