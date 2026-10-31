import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware to protect authenticated routes.
 * Checks for the Better Auth session cookie (the only session, RNX-49).
 * Redirects to /login if it is not present.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check for the session cookie
  // In production with secure cookies, Better Auth prefixes names with __Secure-
  const sessionToken =
    request.cookies.get("better-auth.session_token")?.value ||
    request.cookies.get("__Secure-better-auth.session_token")?.value;

  const isAuthenticated = !!sessionToken;

  if (!isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/agents/:path*",
    "/top-up/:path*",
    "/profile/:path*",
    "/settings/:path*",
    "/knowledge/:path*",
    "/memory/:path*",
    "/onboarding/:path*",
  ],
};
