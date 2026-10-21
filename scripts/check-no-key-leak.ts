// RX-174: checks that no secret value from the environment appears in the given files.
// Run from the repo root so Bun loads .env:  bun scripts/check-no-key-leak.ts <file> [file ...]
// For every env var whose name matches /KEY|TOKEN|SECRET|PASSWORD/i and whose value has 8 or more
// characters, it looks for the value itself, its last 6 characters (a provider may echo a key's tail)
// and its SHA-256 in hex (a provider may echo a key's hash). It prints "<NAME>: found (<form>) in <file>"
// or "<NAME>: not found". It never prints a value, a tail or a hash.
// RNX-18: it also looks for anything shaped like one of our API keys (`rnx_live_` and 8 or more letters or digits)
// and prints "rnx_live_ key: found in <file>" or "rnx_live_ key: not found", never the key.
// Exit code 1 when anything is found, 2 on bad usage or an unreadable file, else 0.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;
const MIN_VALUE_LENGTH = 8;
const TAIL_LENGTH = 6;
const API_KEY_SHAPE = /\brnx_live_[A-Za-z0-9]{8,}/;

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: bun scripts/check-no-key-leak.ts <file> [file ...]");
  process.exit(2);
}

const contents = files.map((file) => ({ file, text: readFileSync(file, "utf8") }));
const secrets = Object.entries(process.env)
  .filter(([name, value]) => SECRET_NAME.test(name) && (value?.length ?? 0) >= MIN_VALUE_LENGTH)
  .sort(([a], [b]) => a.localeCompare(b));

/** The forms of a secret looked for: the value, its tail and its SHA-256 (hex, case-insensitive). */
const formsOf = (value: string): { readonly form: string; readonly needle: string; readonly isCaseless: boolean }[] => [
  { form: "value", needle: value, isCaseless: false },
  { form: "tail", needle: value.slice(-TAIL_LENGTH), isCaseless: false },
  { form: "sha256", needle: createHash("sha256").update(value).digest("hex"), isCaseless: true },
];

let isLeaking = false;
for (const [name, value] of secrets) {
  const hits = contents.flatMap(({ file, text }) =>
    formsOf(value as string)
      .filter(({ needle, isCaseless }) => (isCaseless ? text.toLowerCase().includes(needle) : text.includes(needle)))
      .map(({ form }) => `${name}: found (${form}) in ${file}`),
  );
  isLeaking ||= hits.length > 0;
  console.log(hits.length ? hits.join("\n") : `${name}: not found`);
}
const keyHits = contents.filter(({ text }) => API_KEY_SHAPE.test(text)).map(({ file }) => `rnx_live_ key: found in ${file}`);
isLeaking ||= keyHits.length > 0;
console.log(keyHits.length ? keyHits.join("\n") : "rnx_live_ key: not found");
console.log(`${secrets.length} variables checked against ${files.length} files`);
process.exitCode = isLeaking ? 1 : 0;
