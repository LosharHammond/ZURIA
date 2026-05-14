"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useMemo, useState } from "react";
import { auth, firebaseReady, initFirebasePersistence } from "@/lib/firebase/config";
import { getAppUser, getBusiness } from "@/lib/services/business-service";
import { useAppStore } from "@/stores/app-store";

interface AuthContextValue {
  firebaseUser?: User;
  initializing: boolean;
  firebaseReady: boolean;
}

const AuthContext = createContext<AuthContextValue>({ initializing: true, firebaseReady });

// Routes that require authentication (client-side guard after auth resolves)
const APP_ROUTES = [
  "/dashboard", "/transactions", "/debts", "/inventory",
  "/notifications", "/profile", "/admin", "/welcome",
  "/subscription", "/referrals",
];
const AUTH_ROUTES = ["/login", "/verify"];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | undefined>();
  const [initializing, setInitializing] = useState(true);
  // Ref stores onboarding state so the routing effect can read the latest
  // value without being added as a dep to the auth subscription effect.
  const onboardingCompleteRef = useRef<boolean | undefined>(undefined);
  const router = useRouter();
  const pathname = usePathname();
  const { setUser, setBusiness, setLoading, clearUserData } = useAppStore();

  // ── Auth subscription ─────────────────────────────────────────────────────
  // Intentionally has an empty dep array — putting `pathname` here caused the
  // Firebase listener to be torn down and re-created on every navigation,
  // resulting in repeated profile fetches and potential redirect loops.
  useEffect(() => {
    initFirebasePersistence();
    if (!auth) {
      setInitializing(false);
      setLoading(false);
      return;
    }

    // onAuthStateChanged fires immediately with the persisted session (IndexedDB).
    // We wait for this before doing any redirect so there's no flash to /login.
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUserResult) => {
      setFirebaseUser(firebaseUserResult ?? undefined);

      if (!firebaseUserResult) {
        // Clear the session cookie so middleware knows the user is signed out
        document.cookie = "zuria_auth=; path=/; max-age=0; SameSite=Strict";
        // Wipe ALL user-scoped state — prevents data bleeding between sessions
        clearUserData();
        onboardingCompleteRef.current = undefined;
        setInitializing(false);
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
        onboardingCompleteRef.current = profile?.onboardingComplete;
        if (profile?.businessId) {
          setBusiness(await getBusiness(profile.businessId));
        }
      } catch (err) {
        console.error("[auth] failed to load profile:", err);
      } finally {
        setInitializing(false);
        setLoading(false);
      }
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable — routing is handled by the effect below

  // ── Routing effect — reacts to pathname changes after auth resolves ───────
  useEffect(() => {
    if (initializing) return;

    if (!firebaseUser) {
      const isProtected = APP_ROUTES.some((r) => pathname.startsWith(r));
      if (isProtected) router.replace("/login");
      return;
    }

    // New user: force onboarding before they can reach any app route
    if (!onboardingCompleteRef.current && pathname !== "/onboarding") {
      router.replace("/onboarding");
      return;
    }

    // Already authenticated: redirect away from auth pages
    if (AUTH_ROUTES.some((r) => pathname.startsWith(r))) {
      router.replace("/dashboard");
    }
  }, [firebaseUser, initializing, pathname, router]);

  const value = useMemo(() => ({ firebaseUser, initializing, firebaseReady }), [firebaseUser, initializing]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

