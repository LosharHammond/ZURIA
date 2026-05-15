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
const AUTH_ROUTES = ["/login", "/verify", "/signup"];

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
      // Reset initializing on every auth-state change so the routing effect
      // waits for the profile fetch before making redirect decisions.
      // Without this reset, the effect fires immediately after setFirebaseUser
      // with onboardingCompleteRef.current still undefined — causing returning
      // users with a valid profile to be incorrectly sent to /onboarding.
      setInitializing(true);
      setFirebaseUser(firebaseUserResult ?? undefined);

      if (!firebaseUserResult) {
        // Clear the session cookie so middleware knows the user is signed out
        fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
        // Wipe ALL user-scoped state — prevents data bleeding between sessions
        clearUserData();
        onboardingCompleteRef.current = undefined;
        setInitializing(false);
        return;
      }

      // Ask the server to mint a signed HttpOnly session cookie for middleware.
      // Data access still relies on Firebase tokens/rules; this only protects
      // page-level redirects from client-side cookie spoofing.
      firebaseUserResult
        .getIdToken()
        .then((token) =>
          fetch("/api/auth/session", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          })
        )
        .catch(() => {});

      // User is authenticated — load profile before enabling routing decisions.
      // Only the user profile is needed to make routing decisions (onboardingComplete).
      // Business data is fetched in the background so routing is unblocked sooner.
      let profile;
      try {
        profile = await getAppUser(firebaseUserResult.uid);
        setUser(profile);
        onboardingCompleteRef.current = profile?.onboardingComplete;

        // Fire business fetch in background — routing doesn't depend on it.
        // UI will show business name/data once this promise settles (~200 ms later).
        if (profile?.businessId) {
          getBusiness(profile.businessId)
            .then((biz) => { if (biz) setBusiness(biz); })
            .catch(() => {}); // getBusiness already logs internally
        }
      } catch (err) {
        // Profile fetch failed (network / Firestore rules). Keep
        // onboardingCompleteRef.current as undefined so we don't accidentally
        // redirect a returning user to onboarding — treat as "unknown" and
        // let them stay where they are.
        console.error("[auth] failed to load profile:", err);
      } finally {
        // Release the initialization gate as soon as the user profile resolves.
        // Business data settling in the background won't block the app shell.
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

    // Authenticated user — check onboarding state.
    // onboardingCompleteRef.current is:
    //   true      → profile loaded, onboarding done
    //   false     → profile loaded, onboarding NOT done → send to onboarding
    //   undefined → profile fetch failed (network error) — do NOT redirect
    //               to onboarding; keep user where they are to avoid a loop.

    if (onboardingCompleteRef.current === false && pathname !== "/onboarding") {
      // Strict false check: only redirect when we KNOW onboarding is incomplete
      router.replace("/onboarding");
      return;
    }

    if (onboardingCompleteRef.current === true && pathname === "/onboarding") {
      // Already onboarded — redirect away from onboarding page
      router.replace("/dashboard");
      return;
    }

    // Already authenticated: redirect away from auth pages (login, verify, signup)
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
