// Seed model check (RX-150): every model `prisma/seed.ts` seeds must be served by OpenRouter.
// Reads each `providerId: "<id>"` of the seed and looks it up in OpenRouter's public model list
// (https://openrouter.ai/api/v1/models, no key). Fails and names the id when it is not on the list,
// or when the list gives it an `expiration_date` (OpenRouter removes the model on that day).
// Run by hand, not by `bun run check` (it needs the network):
//   bun scripts/check-seed-models.ts            the seed in the working tree
//   bun scripts/check-seed-models.ts <git-ref>  the seed at that commit, e.g. origin/main
// Not read: a providerId that is not written as a string literal on a `providerId:` line, and
// models added outside prisma/seed.ts (prisma/seed-agents.ts creates none).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SEED = "prisma/seed.ts";
const LIST_URL = "https://openrouter.ai/api/v1/models";

type ListedModel = { id: string; expiration_date?: string | null };

function readSeed(ref: string | undefined): string {
  if (!ref) return readFileSync(resolve(ROOT, SEED), "utf8");
  const shown = Bun.spawnSync(["git", "show", `${ref}:${SEED}`], { cwd: ROOT });
  if (shown.exitCode !== 0) throw new Error(`git show ${ref}:${SEED} failed: ${shown.stderr.toString().trim()}`);
  return shown.stdout.toString();
}

async function fetchList(): Promise<Map<string, ListedModel>> {
  const response = await fetch(LIST_URL, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${LIST_URL} answered HTTP ${response.status}`);
  const { data } = (await response.json()) as { data: ListedModel[] };
  return new Map(data.map((model) => [model.id, model]));
}

const ref = process.argv[2];
const ids = [...readSeed(ref).matchAll(/^\s*providerId:\s*"([^"]+)"/gm)].map((match) => match[1]);
if (ids.length === 0) {
  console.error(`Seed models: no providerId found in ${ref ?? "the working tree"}'s ${SEED}; nothing was checked.`);
  process.exit(1);
}
const listed = await fetchList();
const missing = ids.filter((id) => !listed.has(id));
const expiring = ids.filter((id) => listed.get(id)?.expiration_date).map((id) => `${id} (expiration_date ${listed.get(id)?.expiration_date})`);
const source = `${SEED} at ${ref ?? "the working tree"}`;
if (missing.length) {
  console.error(`Seed models: ${missing.length} of ${ids.length} in ${source} are not on OpenRouter's list:`);
  for (const id of missing) console.error(`  ${id}`);
}
if (expiring.length) {
  console.error(`Seed models: ${expiring.length} of ${ids.length} in ${source} have a removal date on OpenRouter's list:`);
  for (const line of expiring) console.error(`  ${line}`);
}
if (missing.length || expiring.length) process.exit(1);
console.log(`Seed models: all ${ids.length} in ${source} are on OpenRouter's list (${listed.size} models) with no removal date.`);
