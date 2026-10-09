import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware to protect authenticated routes.
 * Checks for Better Auth session cookie or JWT cookie. The `jwt` cookie is
 * the httpOnly cookie the API sets on email login/register (RX-68).
 * Redirects to /login if neither is present.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check for authentication tokens
  // In production with secure cookies, Better Auth prefixes names with __Secure-
  const sessionToken =
    request.cookies.get("better-auth.session_token")?.value ||
    request.cookies.get("__Secure-better-auth.session_token")?.value;
  const jwt = request.cookies.get("jwt")?.value;

  const isAuthenticated = !!sessionToken || !!jwt;

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
    "/knowledge/:path*",
    "/memory/:path*",
  ],
};
