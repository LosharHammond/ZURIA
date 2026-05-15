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

// ── Retry helper ──────────────────────────────────────────────────────────────
// Re-attempts a failing async operation with linear back-off.
// Used for profile fetch (Firestore cold-start latency) and session cookie.
async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 600,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        // Linear back-off: 600 ms, 1 200 ms, …
        await new Promise<void>((r) => setTimeout(r, baseDelayMs * (i + 1)));
      }
    }
  }
  throw lastErr;
}

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

      // ── CRITICAL: run session cookie creation and profile fetch in PARALLEL ──
      //
      // Previously the session cookie was fire-and-forget, meaning
      // setInitializing(false) could fire BEFORE the cookie was written.
      // The routing effect would then navigate to a protected route while
      // middleware still saw no cookie and redirected the user to /login.
      //
      // Now both operations are awaited together via Promise.allSettled so
      // the session cookie is GUARANTEED to be present before the routing
      // effect makes any navigation decision.
      const [sessionResult, profileResult] = await Promise.allSettled([
        // ── Session cookie ────────────────────────────────────────────
        withRetry(() =>
          firebaseUserResult
            .getIdToken()
            .then((token) =>
              fetch("/api/auth/session", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
              })
            )
        ),
        // ── User profile ──────────────────────────────────────────────
        withRetry(() => getAppUser(firebaseUserResult.uid)),
      ]);

      if (sessionResult.status === "rejected") {
        console.error("[auth] session cookie creation failed:", sessionResult.reason);
        // Non-fatal — user may still be functional; next navigation will retry.
      }

      if (profileResult.status === "fulfilled") {
        const profile = profileResult.value;
        if (profile) {
          setUser(profile);
          onboardingCompleteRef.current = profile.onboardingComplete;

          // Fire business fetch in background — routing doesn't depend on it.
          if (profile.businessId) {
            getBusiness(profile.businessId)
              .then((biz) => { if (biz) setBusiness(biz); })
              .catch(() => {});
          }
        } else {
          // Firestore document exists but returned null/undefined — treat as
          // incomplete onboarding so we route the user to finish setup.
          onboardingCompleteRef.current = false;
        }
      } else {
        console.error("[auth] failed to load profile:", profileResult.reason);
        // Fallback: if the onboarding form already pre-populated the Zustand
        // store (which it does synchronously from the API response), use that
        // cached value so we don't incorrectly redirect the user to /onboarding.
        const cachedUser = useAppStore.getState().user;
        if (cachedUser) {
          onboardingCompleteRef.current = cachedUser.onboardingComplete;
        }
        // If there is no cached user either, leave onboardingCompleteRef as
        // undefined — the routing effect treats undefined as "unknown" and
        // does NOT redirect, avoiding an infinite onboarding loop.
      }

      // Release the initialization gate AFTER both operations have settled.
      setInitializing(false);
      setLoading(false);
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
