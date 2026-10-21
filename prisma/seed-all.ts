// One idempotent fresh-environment seed (RNX-91): `bun run seed`. Runs the existing seed scripts in order, each
// as its own process against the database DATABASE_URL names (each step is idempotent by itself; the steps are
// independent, not one transaction):
//   a. tier rates   (seed-tier-rates.ts, RX-21's audited operator seed)
//   b. agent templates (seed-agents.ts; skipped with a message while no active model exists)
//   c. system prompt and prompt templates (seed.ts)
//   d. guardrail config: no seed source (code constants GUARDRAIL_DEFAULTS; the guardrail_configs table is per agent)
//   e. offer catalog and platform settings (seed-offers.ts, values only in offers.seed.json)
//   f. system knowledge sync (seed-system-knowledge.ts; a failure is a warning, as at API startup)
// It never creates provider or model rows (D150). With NODE_ENV=production it refuses unless --allow-production.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const dir = import.meta.dirname;
if (process.env.NODE_ENV === "production" && !process.argv.includes("--allow-production")) {
  console.error("Refusing to seed with NODE_ENV=production. Pass --allow-production (Tech Lead only) to run it anyway.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}
const steps: { name: string; script: string; args: string[]; fatal: boolean }[] = [
  { name: "a. tier rates", script: "seed-tier-rates.ts", args: [], fatal: true },
  { name: "b. agent templates", script: "seed-agents.ts", args: ["--skip-without-model"], fatal: true },
  { name: "c. system prompts", script: "seed.ts", args: [], fatal: true },
  { name: "e. offer catalog and platform settings", script: "seed-offers.ts", args: [], fatal: true },
  { name: "f. system knowledge sync", script: "seed-system-knowledge.ts", args: [], fatal: false },
];
console.log("== d. guardrail config: no seed source (defaults are code constants); nothing to load");
for (const step of steps) {
  console.log(`== ${step.name}`);
  const { status } = spawnSync("bun", [resolve(dir, step.script), ...step.args], { stdio: "inherit", env: process.env });
  if (status === 0) continue;
  if (step.fatal) {
    console.error(`Seed step "${step.name}" failed (exit ${status}); stopping.`);
    process.exit(1);
  }
  console.warn(`WARNING: step "${step.name}" failed (exit ${status}); the other steps are done.`);
}
console.log("Seed finished.");
