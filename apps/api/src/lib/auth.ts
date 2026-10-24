import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@generated/prisma/client.js";
import crypto from "crypto";
import { getCookieDomain } from "./cookie-domain";
import { readRequiredSecret } from "../common/utils/read-required-secret";
import { readClientIpHeader } from "../common/utils/client-ip-header";
import { resolveTrustedOrigins } from "../common/utils/resolve-trusted-origins";
import { ensureDefaultWorkspace } from "../app/workspace/repository/ensure-default-workspace";

const isProduction = process.env.NODE_ENV === "production";
const clientIpHeader = readClientIpHeader();

let prismaInstance: PrismaClient | null = null;

function getPrisma() {
  if (!prismaInstance) {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    });
    prismaInstance = new PrismaClient({ adapter });
  }
  return prismaInstance;
}

export const auth = betterAuth({
  baseURL: process.env.API_PUBLIC_URL || "http://localhost:3000",
  database: prismaAdapter(getPrisma(), { provider: "postgresql" }),
  basePath: "/api/auth/better",
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
      enabled: !!(
        process.env.GOOGLE_OAUTH_CLIENT_ID &&
        process.env.GOOGLE_OAUTH_CLIENT_SECRET
      ),
    },
    github: {
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET || "",
      enabled: !!(
        process.env.GITHUB_OAUTH_CLIENT_ID &&
        process.env.GITHUB_OAUTH_CLIENT_SECRET
      ),
    },
  },
  session: {
    expiresIn: 7 * 24 * 60 * 60, // 7 days
    updateAge: 24 * 60 * 60, // Refresh session if older than 1 day
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },
  advanced: {
    // RNX-168 (D48, D148): the client IP for better-auth's rate limiter and the session's ipAddress is
    // CLIENT_IP_HEADER only, never X-Forwarded-For. Without it no IP is tracked: better-auth's limiter
    // then skips its checks and the Nest throttler (RX-155) limits /api/auth/better/* per socket address.
    ipAddress: clientIpHeader
      ? { ipAddressHeaders: [clientIpHeader] }
      : { disableIpTracking: true },
    database: {
      generateId: () => crypto.randomUUID(),
    },
    crossSubDomainCookies: {
      enabled: isProduction,
      domain: getCookieDomain(),
    },
    defaultCookieAttributes: {
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
    },
  },
  secret: readRequiredSecret(process.env, "BETTER_AUTH_SECRET"),
  // RNX-277: the same allowed-origins list as CORS and UserOriginGuard (resolveCorsOrigins: CORS_ORIGIN +
  // ADMIN_ORIGIN, required outside development and test), never a localhost fallback. Development and test with
  // CORS_ORIGIN unset trust the local origins (localhost:3000/4200/4201 and API_PUBLIC_URL's origin).
  trustedOrigins: resolveTrustedOrigins(process.env),
  // Every new account gets its default workspace (RNX-117): social and email sign-up both create the user
  // here. Better Auth runs `after` hooks once the user's transaction has committed.
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await ensureDefaultWorkspace(getPrisma(), user.id);
        },
      },
    },
  },
  user: {
    modelName: "User",
    fields: {
      image: "avatar",
    },
    additionalFields: {
      phone: { type: "string", required: false },
      company: { type: "string", required: false },
      jobTitle: { type: "string", required: false },
      timezone: { type: "string", required: false, defaultValue: "UTC" },
      locale: { type: "string", required: false, defaultValue: "en" },
      status: { type: "string", required: false, defaultValue: "active" },
      firstName: { type: "string", required: false },
      lastName: { type: "string", required: false },
    },
  },
});

export type Auth = typeof auth;
