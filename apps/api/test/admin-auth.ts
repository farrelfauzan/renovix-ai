import { Controller, Get, Req } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import type { LightMyRequestResponse } from "fastify";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateSync } from "otplib";
import { PasswordService } from "../src/app/admin-auth/service/password.service";
import { TotpService } from "../src/app/admin-auth/service/totp.service";
import type { PrismaService } from "../src/app/prisma/prisma.service";
import { Access } from "../src/common/decorators/access.decorator";

// Shared tooling of the back-office sign-in specs (RX-94). Obviously fake values only.

/** A password that passes every rule. */
export const ADMIN_PASSWORD = "Tq8#vLm2Pz!w-rx94-test";
export const WRONG_PASSWORD = "Wrong#Pass-rx94-test";
export const MINUTE = 60_000;
/** Base time of the fake clock: one second into a 30-second TOTP step. */
export const START = new Date("2026-10-14T08:00:01Z");
/** Only Date is faked: the database driver and Fastify keep their real timers. The clock stands still. */
const NOT_DATE = [
  "hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame",
  "requestIdleCallback", "cancelIdleCallback", "setImmediate", "clearImmediate", "setInterval",
  "clearInterval", "setTimeout", "clearTimeout",
] as const;

/** Fakes Date only, at START. Undo with `jest.useRealTimers()`. */
export const useFakeDate = () => jest.useFakeTimers({ doNotFake: [...NOT_DATE], now: START });
/** Moves the fake clock forward. */
export const advance = (ms: number) => jest.setSystemTime(Date.now() + ms);
/** Moves to the next 30-second TOTP step. */
export const nextStep = () => advance(30_000);
/** The current TOTP code of a secret, on the fake clock. */
export const totpCode = (secret: string): string => generateSync({ secret });

/** A test-only back-office route (criterion 1: "every other back-office route answers 403"). */
@Controller("admin/probe")
export class BackOfficeProbeController {
  @Get()
  @Access({ auth: ["staff"] })
  probe(@Req() request: { admin?: unknown }) {
    return { admin: request.admin ?? null };
  }

  @Get("sensitive")
  @Access({ auth: ["staff"], reauth: true })
  sensitive(@Req() request: { admin?: unknown }) {
    return { admin: request.admin ?? null };
  }
}

/** The migration that seeds the built-in roles (RX-96); its INSERT is the only copy of PRD 09 F5's role table. */
const ROLES_MIGRATION = resolve(__dirname, "../../../prisma/migrations/20261014200000_baseline/migration.sql");
/** The migration that grants `audit:read` to the built-in roles but Support (RX-164, D138). */
const AUDIT_READ_MIGRATION = resolve(__dirname, "../../../prisma/migrations/20261015200000_audit_read_permission/migration.sql");
/** The migration that grants `profit:read` and `reconciliation:write` to owner and finance (RNX-228). */
const PROFIT_PERMISSIONS_MIGRATION = resolve(__dirname, "../../../prisma/migrations/20261022040000_profit_reconciliation_permissions/migration.sql");

/**
 * Inserts the built-in roles again, with the migrations' own statements: the baseline INSERT, then
 * RX-164's `audit:read` grant and RNX-228's `profit:read` and `reconciliation:write` grants (resetDatabase
 * empties `admin_roles` like every other table). Roles that exist are left as they are, and a role that
 * holds a granted permission already does not get it twice.
 */
export async function seedAdminRoles(prisma: PrismaService): Promise<void> {
  const insert = /INSERT INTO "admin_roles"[\s\S]*?ON CONFLICT \("name"\) DO NOTHING;/.exec(readFileSync(ROLES_MIGRATION, "utf8"));
  if (!insert) throw new Error(`no INSERT INTO "admin_roles" ... ON CONFLICT in ${ROLES_MIGRATION}`);
  await prisma.$executeRawUnsafe(insert[0]);
  const grant = /UPDATE "admin_roles"[\s\S]*?;/.exec(readFileSync(AUDIT_READ_MIGRATION, "utf8"));
  if (!grant) throw new Error(`no UPDATE "admin_roles" in ${AUDIT_READ_MIGRATION}`);
  await prisma.$executeRawUnsafe(grant[0]);
  const profitGrants = readFileSync(PROFIT_PERMISSIONS_MIGRATION, "utf8").match(/UPDATE "admin_roles"[\s\S]*?;/g) ?? [];
  if (profitGrants.length !== 2) throw new Error(`expected two UPDATE "admin_roles" in ${PROFIT_PERMISSIONS_MIGRATION}`);
  for (const statement of profitGrants) await prisma.$executeRawUnsafe(statement);
}

/** Creates an admin with ADMIN_PASSWORD (built-in roles seeded first); `enrolled` gives them an active TOTP secret (returned). */
export async function createAdmin(
  prisma: PrismaService,
  moduleRef: TestingModule,
  { email, enrolled = false, role = "operations" }: { email: string; enrolled?: boolean; role?: string },
): Promise<{ id: string; email: string; secret: string }> {
  await seedAdminRoles(prisma);
  const passwordHash = await moduleRef.get(PasswordService).hash(ADMIN_PASSWORD);
  const row = await prisma.adminUser.create({ data: { email, passwordHash, role } });
  if (!enrolled) return { id: row.id, email, secret: "" };
  const { secret, encrypted } = moduleRef.get(TotpService).createSecret(row.id, email);
  await prisma.adminUser.update({ where: { id: row.id }, data: { totpSecretEncrypted: encrypted, totpEnrolledAt: new Date() } });
  return { id: row.id, email, secret };
}

/** The Set-Cookie values of a response, as an array. */
export const setCookies = (res: LightMyRequestResponse): string[] => {
  const header = res.headers["set-cookie"];
  return header === undefined ? [] : Array.isArray(header) ? header : [header];
};

/** `name=value` of the named cookie set by the response, ready for a Cookie header. */
export const cookieOf = (res: LightMyRequestResponse, name: string): string => {
  const found = setCookies(res).find((cookie) => cookie.startsWith(`${name}=`));
  if (!found) throw new Error(`no ${name} cookie in the response`);
  return found.split(";")[0];
};
export const accessCookie = (res: LightMyRequestResponse) => cookieOf(res, "rx_admin_access");
export const refreshCookie = (res: LightMyRequestResponse) => cookieOf(res, "rx_admin_refresh");

/** The Origin header of the back-office (RX-156: /admin routes refuse any other; ADMIN_ORIGIN in setup-env.ts). */
export const BACK_OFFICE_ORIGIN = { origin: process.env.ADMIN_ORIGIN as string };

/** HTTP helpers on the app (routes have no /api/v1 prefix in tests); every call carries the back-office Origin. */
export const adminHttp = (app: NestFastifyApplication) => ({
  signIn: (body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/admin/auth/sign-in", headers: BACK_OFFICE_ORIGIN, payload: body }),
  refresh: (cookie?: string) =>
    app.inject({ method: "POST", url: "/admin/auth/refresh", headers: cookie ? { ...BACK_OFFICE_ORIGIN, cookie } : BACK_OFFICE_ORIGIN }),
  call: (method: "GET" | "POST" | "DELETE", url: string, headers: Record<string, string> = {}, payload?: object) =>
    app.inject({ method, url, headers: { ...BACK_OFFICE_ORIGIN, ...headers }, payload }),
});
