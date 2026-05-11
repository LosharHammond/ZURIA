"use client";

import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/providers/auth-provider";
import { SyncProvider } from "@/providers/sync-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" enableSystem={false}>
      <AuthProvider>
        <SyncProvider>{children}</SyncProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
