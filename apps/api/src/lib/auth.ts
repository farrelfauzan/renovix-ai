import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@generated/prisma/client.js";
import crypto from "crypto";
import { getCookieDomain } from "./cookie-domain";

const isProduction = process.env.NODE_ENV === "production";

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
  secret:
    process.env.BETTER_AUTH_SECRET || process.env.JWT_SECRET || "change-me",
  trustedOrigins: [
    process.env.DASHBOARD_URL || "http://localhost:4200",
    process.env.CHAT_APP_URL || "http://localhost:4201",
    process.env.APP_BASE_URL || "http://localhost:3000",
  ],
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
