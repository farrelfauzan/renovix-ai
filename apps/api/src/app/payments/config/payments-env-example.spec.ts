import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";

// RNX-278: every environment variable the payments code reads (`env.X`, `process.env.X`, `env["X"]`) is listed in
// .env.example, so a new AutoGoPay or payments setting cannot ship without its example line.
const PAYMENTS_DIR = join(__dirname, "..");
const ENV_EXAMPLE = join(__dirname, "../../../../../../.env.example");
const ENV_READ = /\b(?:process\.)?env(?:\.([A-Z][A-Z0-9_]*)|\[["']([A-Z][A-Z0-9_]*)["']\])/g;

/** Every non-spec TypeScript file under `dir`, recursively. */
const sourceFilesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesIn(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [path] : [];
  });

/** The environment variable names read in `source`. */
const envReadsIn = (source: string): string[] => [...source.matchAll(ENV_READ)].map((match) => match[1] ?? match[2]);

describe("RNX-278: .env.example lists every environment variable the payments code reads", () => {
  it("finds the payments env reads (control: the scan is not empty)", () => {
    const actualNames = new Set(sourceFilesIn(PAYMENTS_DIR).flatMap((file) => envReadsIn(readFileSync(file, "utf8"))));

    expect([...actualNames].sort()).toEqual(
      expect.arrayContaining(["PAYMENTS_FORCE_OFF", "PAYMENT_FAKE_WEBHOOK_SECRET", "PAYMENT_PROVIDER", "PAYMENT_PROVIDER_API_KEY"]),
    );
  });

  it("every name read under apps/api/src/app/payments is a key in .env.example", () => {
    const exampleKeys = Object.keys(parse(readFileSync(ENV_EXAMPLE)));
    const readNames = new Set(sourceFilesIn(PAYMENTS_DIR).flatMap((file) => envReadsIn(readFileSync(file, "utf8"))));

    const actualMissing = [...readNames].filter((name) => !exampleKeys.includes(name)).sort();

    expect(actualMissing).toEqual([]);
  });

  it("the AutoGoPay key stays empty in .env.example (no real key in the repository)", () => {
    const example = parse(readFileSync(ENV_EXAMPLE));

    expect(example.PAYMENT_PROVIDER_API_KEY).toBe("");
  });
});
