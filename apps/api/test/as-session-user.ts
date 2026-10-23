import { randomUUID } from "node:crypto";
import { auth } from "../src/lib/auth";

// RNX-225: the signed-in product user of a spec is a Better Auth session cookie (the login JWT is retired). The
// spec's lib/auth is a mock (setup-env.ts's, or the spec's own plain-object one): this helper makes its
// `getSession` answer the user whose made-up cookie the request carries, and null for any other request. A spec
// that programs `getSession` itself (a jest.fn) does not use this helper.

/** Better Auth's session cookie name outside production. */
const SESSION_COOKIE = "better-auth.session_token";

type SessionUser = { readonly id: string; readonly email: string };
type GetSession = (options: { headers: Headers }) => Promise<{ user: SessionUser; session: { id: string } } | null>;

const signedIn = new Map<string, SessionUser>();

/** The made-up session token in a Cookie header, if it carries one. */
function readSessionToken(cookieHeader: string | null): string | undefined {
  const pair = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return pair?.slice(SESSION_COOKIE.length + 1);
}

/** The mocked getSession: the user of a cookie this helper issued, else null (no session). */
const getTestSession: GetSession = async ({ headers }) => {
  const token = readSessionToken(headers.get("cookie"));
  const user = token === undefined ? undefined : signedIn.get(token);
  return user ? { user: { id: user.id, email: user.email }, session: { id: token as string } } : null;
};

(auth.api as unknown as { getSession: GetSession }).getSession = getTestSession;

/** The `cookie` header of a request signed in as this user (a fresh made-up session each call). */
export function asSessionUser(user: SessionUser): { cookie: string } {
  const token = `test-session-${randomUUID()}`;
  signedIn.set(token, { id: user.id, email: user.email });
  return { cookie: `${SESSION_COOKIE}=${token}` };
}
