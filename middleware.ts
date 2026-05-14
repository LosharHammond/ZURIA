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
  "/onboarding", // new users must be authenticated to complete onboarding
];

// Routes that should redirect to dashboard if already authenticated
const AUTH_PREFIXES = ["/login", "/verify", "/signup"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Check for the auth session cookie (set by auth-provider on sign-in).
  // NOTE: This only verifies cookie presence for page-level redirects.
  // The cookie value is NOT cryptographically verified here because Edge
  // middleware cannot call Firebase Admin SDK. All API routes perform their
  // own server-side token verification via verifyIdToken / verifyAdminToken.
  // A user who sets an arbitrary cookie value will reach the dashboard HTML
  // but every authenticated API call will still return 401/403.
  const cookieVal = req.cookies.get("zuria_auth")?.value ?? "";
  const isAuthenticated = cookieVal.length > 0;

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
