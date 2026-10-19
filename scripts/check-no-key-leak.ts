// RX-174: checks that no secret value from the environment appears in the given files.
// Run from the repo root so Bun loads .env:  bun scripts/check-no-key-leak.ts <file> [file ...]
// For every env var whose name matches /KEY|TOKEN|SECRET|PASSWORD/i and whose value has 8 or more
// characters, it prints "<NAME>: found in <file>" or "<NAME>: not found". It never prints a value.
// Exit code 1 when any value is found, 2 on bad usage or an unreadable file, else 0.
import { readFileSync } from "node:fs";

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;
const MIN_VALUE_LENGTH = 8;

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: bun scripts/check-no-key-leak.ts <file> [file ...]");
  process.exit(2);
}

const contents = files.map((file) => ({ file, text: readFileSync(file, "utf8") }));
const secrets = Object.entries(process.env)
  .filter(([name, value]) => SECRET_NAME.test(name) && (value?.length ?? 0) >= MIN_VALUE_LENGTH)
  .sort(([a], [b]) => a.localeCompare(b));

let isLeaking = false;
for (const [name, value] of secrets) {
  const hits = contents.filter(({ text }) => text.includes(value as string)).map(({ file }) => file);
  isLeaking ||= hits.length > 0;
  console.log(hits.length ? hits.map((file) => `${name}: found in ${file}`).join("\n") : `${name}: not found`);
}
console.log(`${secrets.length} variables checked against ${files.length} files`);
process.exitCode = isLeaking ? 1 : 0;
