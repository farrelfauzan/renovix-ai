// Creates a back-office owner (RX-94). No route creates an admin and there is no self sign-up: the first
// owner comes from this script, later admins from invitations (RX-95).
//
// It writes to the database that DATABASE_URL names (from the environment or .env). Check it first.
// The password never goes on the command line: pipe it on stdin, or put it in ADMIN_PASSWORD, e.g.
//   read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD && bun scripts/create-admin.ts owner@example.com; unset ADMIN_PASSWORD
// The same rules as the API apply (length, breached list, "renovix", the email name; Argon2id with the
// configured cost). The owner signs in with the password alone and then must enrol TOTP.
import "dotenv/config";
import "reflect-metadata";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
import { PasswordService } from "../apps/api/src/app/admin-auth/service/password.service";
import { parseAdminAuthConfig } from "../apps/api/src/app/admin-auth/utils/parse-admin-auth-config";

async function readPassword(): Promise<string> {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (process.stdin.isTTY) throw new Error("Set ADMIN_PASSWORD or pipe the password on stdin (never as an argument).");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+$/.test(email) || process.argv.length !== 3) {
  console.error("Usage: bun scripts/create-admin.ts <email>   (password from ADMIN_PASSWORD or stdin)");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}
const target = new URL(process.env.DATABASE_URL);
const passwords = new PasswordService(parseAdminAuthConfig((name) => process.env[name]));
const password = await readPassword();
try {
  passwords.assertAcceptable(password, email);
} catch (err) {
  console.error(`Password refused: ${(err as Error).message}`);
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  if (await prisma.adminUser.findUnique({ where: { email } })) {
    console.error(`An admin with the email ${email} already exists; nothing written.`);
    process.exit(1);
  }
  const admin = await prisma.adminUser.create({
    data: { email, passwordHash: await passwords.hash(password), role: "owner" },
  });
  console.log(`Created owner ${email} (id ${admin.id}) in database "${target.pathname.slice(1)}" on ${target.hostname}:${target.port || 5432}.`);
} finally {
  await prisma.$disconnect();
}
