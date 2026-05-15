import { type NextRequest, NextResponse } from "next/server";

// Routes that require the user to be authenticated
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/transactions",
  "/debts",
  "/inventory",
  "/notifications",
  "/profile",
  "/admin",
  "/referrals",
  "/welcome",
  "/subscription",
  // NOTE: /onboarding is intentionally NOT protected here.
  // New users reach it before authentication (server-side registration flow).
  // The OnboardingForm itself handles the "already onboarded" redirect.
  // The auth-provider's routing effect redirects authenticated+incomplete users to it.
];

// Routes that should redirect to dashboard if already authenticated
const AUTH_PREFIXES = ["/login", "/verify", "/signup"];

function getSessionSecret(): string {
  return process.env.AUTH_SESSION_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "development-only-zuria-session-secret");
}

function base64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return base64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function hasValidSession(cookieVal: string): Promise<boolean> {
  if (!cookieVal || !getSessionSecret()) return false;
  const parts = cookieVal.split(".");
  if (parts.length !== 3) return false;
  const [uid, exp, sig] = parts;
  if (!uid || !/^\d+$/.test(exp) || Number(exp) <= Math.floor(Date.now() / 1000)) return false;
  return sig === await sign(`${uid}.${exp}`);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const cookieVal = req.cookies.get("zuria_auth")?.value ?? "";
  const isAuthenticated = await hasValidSession(cookieVal);

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  const isAuthPage = AUTH_PREFIXES.some((p) => pathname.startsWith(p));

  if (isProtected && !isAuthenticated) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (isAuthPage && isAuthenticated) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on all pages except Next.js internals and static files
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.json|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff|woff2)).*)",
  ],
};
