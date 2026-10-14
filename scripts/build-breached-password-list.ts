// Rebuilds the offline breached-password list of the back-office sign-in (RX-94, D61, research note R-6).
//
// Source: SecLists (MIT licence, "Copyright (c) 2018 Daniel Miessler"), file
// Passwords/Common-Credentials/Pwdb_top-1000000.txt at the pinned commit below, checked against its SHA-256.
// Filter: entries of at least MIN_LENGTH characters (Unicode code points), in the source order.
// Shorter entries are refused by the length rule anyway, so they are left out. If the minimum password length
// (ADMIN_AUTH_PASSWORD_MIN_LENGTH) is ever lowered, rebuild with that length.
//
// Usage: bun scripts/build-breached-password-list.ts [minLength=12]
// Writes apps/api/src/app/admin-auth/assets/breached-passwords-min<minLength>.json (a JSON array, one entry per line).
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const COMMIT = "3a5f62f0e18a1b8a36b25399aff0077f3706e5af"; // SecLists, 2026-10-13
const URL = `https://raw.githubusercontent.com/danielmiessler/SecLists/${COMMIT}/Passwords/Common-Credentials/Pwdb_top-1000000.txt`;
const SHA256 = "e9a88f67aafe65496682dc374559ee714e978bee50314767494c3e37a18c9fc8";
const MIN_LENGTH = Number(process.argv[2] ?? 12);

if (!Number.isInteger(MIN_LENGTH) || MIN_LENGTH < 1) throw new Error(`minLength must be a positive integer, got ${process.argv[2]}`);
const response = await fetch(URL);
if (!response.ok) throw new Error(`Download failed: ${response.status} ${URL}`);
const bytes = Buffer.from(await response.arrayBuffer());
const digest = createHash("sha256").update(bytes).digest("hex");
if (digest !== SHA256) throw new Error(`SHA-256 mismatch: expected ${SHA256}, got ${digest}`);
const entries = bytes
  .toString("utf8")
  .split("\n")
  .filter((line) => [...line].length >= MIN_LENGTH);
const out = resolve(import.meta.dir, `../apps/api/src/app/admin-auth/assets/breached-passwords-min${MIN_LENGTH}.json`);
writeFileSync(out, `[\n${entries.map((entry) => JSON.stringify(entry)).join(",\n")}\n]\n`);
console.log(`${entries.length} entries of ${MIN_LENGTH}+ characters written to ${out}`);
