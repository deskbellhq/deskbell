import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Optimistic redirect only (spec: dashboard-auth): a cookie-presence check so
 * signed-out visitors land on /login without a flash of dashboard chrome. It
 * proves NOTHING — cookies are attacker-supplied — and no data sits behind it;
 * the real check is requireMember() in the data layer on every request.
 *
 * The matcher enumerates dashboard paths so the public widget surface
 * (/api/v1/*, /deskbell.js) and /api/auth/* can never be caught here.
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const login = new URL("/login", request.url);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/sources/:path*", "/conversations/:path*", "/gaps/:path*", "/settings/:path*"],
};
