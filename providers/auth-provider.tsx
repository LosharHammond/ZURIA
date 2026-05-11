"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { auth, firebaseReady, initFirebasePersistence } from "@/lib/firebase/config";
import { getAppUser, getBusiness } from "@/lib/services/business-service";
import { useAppStore } from "@/stores/app-store";

interface AuthContextValue {
  firebaseUser?: User;
  initializing: boolean;
  firebaseReady: boolean;
}

const AuthContext = createContext<AuthContextValue>({ initializing: true, firebaseReady });

const APP_ROUTES = ["/dashboard", "/transactions", "/debts", "/inventory", "/notifications", "/profile", "/admin"];
const AUTH_ROUTES = ["/login", "/verify"];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User>();
  const [initializing, setInitializing] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const { setUser, setBusiness, setLoading } = useAppStore();

  useEffect(() => {
    initFirebasePersistence();
    if (!auth) {
      setInitializing(false);
      setLoading(false);
      return;
    }

    // onAuthStateChanged fires immediately with the persisted session (IndexedDB).
    // We wait for this before doing any redirect so there's no flash to /login.
    return onAuthStateChanged(auth, async (firebaseUserResult) => {
      setFirebaseUser(firebaseUserResult ?? undefined);

      if (!firebaseUserResult) {
        // Clear the session cookie so middleware knows the user is signed out
        document.cookie = "zuria_auth=; path=/; max-age=0; SameSite=Strict";
        setUser(undefined);
        setBusiness(undefined);
        setInitializing(false);
        setLoading(false);
        const isProtected = APP_ROUTES.some((r) => pathname.startsWith(r));
        if (isProtected) router.replace("/login");
        return;
      }

      // Set a session cookie so Next.js middleware can enforce route protection.
      // This is NOT a security token — just a presence signal. Real auth is verified
      // via Firebase on every data request (Firestore rules + API token verification).
      document.cookie = "zuria_auth=1; path=/; max-age=86400; SameSite=Strict";

      // User is authenticated — load profile
      let profile;
      try {
        profile = await getAppUser(firebaseUserResult.uid);
        setUser(profile);
        if (profile?.businessId) {
          setBusiness(await getBusiness(profile.businessId));
        }
      } catch (err) {
        console.error("[auth] failed to load profile:", err);
      } finally {
        setInitializing(false);
        setLoading(false);
      }

      // Routing logic
      if (!profile?.onboardingComplete && pathname !== "/onboarding") {
        router.replace("/onboarding");
        return;
      }

      // If on an auth page but already signed in, redirect to dashboard
      if (AUTH_ROUTES.some((r) => pathname.startsWith(r))) {
        router.replace("/dashboard");
      }
    });
  }, [pathname, router, setBusiness, setLoading, setUser]);

  const value = useMemo(() => ({ firebaseUser, initializing, firebaseReady }), [firebaseUser, initializing]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
