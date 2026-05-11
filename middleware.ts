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
];

// Routes that should redirect to dashboard if already authenticated
const AUTH_PREFIXES = ["/login", "/verify"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Check for the auth session cookie (set by auth-provider on sign-in)
  const isAuthenticated = !!req.cookies.get("zuria_auth");

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
