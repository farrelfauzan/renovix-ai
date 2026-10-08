// `bun run check`: the local check set (docs/testing.md). Exit 0 only if every step passes.
// Never runs `docker build` (kept separate on purpose, D29).
import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DUMMY_DB = "postgresql://x:x@localhost:5/x";
const PROGRAMS = [
  "apps/api/tsconfig.app.json",
  "apps/api/tsconfig.spec.json",
  "apps/chat/tsconfig.json",
  "apps/dashboard/tsconfig.json",
  "apps/landing/tsconfig.json",
  // apps/landing/tsconfig.spec.json is left out: it fails with TS6310 on its own (no specs, broken reference).
];

type Env = Record<string, string | undefined>;
const env: Env = { ...process.env };
env.DATABASE_URL ??= DUMMY_DB; // prisma.config.ts needs DATABASE_URL to exist

let child: ReturnType<typeof Bun.spawn> | undefined;
const cleanups: Array<() => Promise<void> | void> = [];
async function cleanup() {
  while (cleanups.length) {
    try {
      await cleanups.pop()!();
    } catch (e) {
      console.error("cleanup failed:", e);
    }
  }
}
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    console.error(`\n${sig}: cleaning up`);
    child?.kill();
    await cleanup();
    process.exit(sig === "SIGINT" ? 130 : 143);
  });
}

/** Run a command; output goes to the terminal. Returns the exit code. */
async function run(cmd: string[], opts: { cwd?: string; env?: Env } = {}) {
  child = Bun.spawn(cmd, { cwd: opts.cwd ?? ROOT, env: opts.env ?? env, stdio: ["inherit", "inherit", "inherit"] });
  const code = await child.exited;
  child = undefined;
  return code;
}

/** Run a command and capture stdout+stderr. */
async function capture(cmd: string[], cwd: string) {
  child = Bun.spawn(cmd, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const code = await child.exited;
  child = undefined;
  return { code, out: out + err };
}

// ---- steps ----

async function testStep(): Promise<boolean> {
  const testEnv: Env = { ...env };
  if (env.TEST_DATABASE_URL) {
    console.log("Test database: using TEST_DATABASE_URL as given (no container started)");
  } else {
    if ((await capture(["docker", "info"], ROOT)).code !== 0) {
      console.error("Docker is not available and TEST_DATABASE_URL is not set: cannot get a test database.");
      return false;
    }
    const project = `renovix-check-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
    const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = probe.port;
    probe.stop(true);
    testEnv.TEST_DB_PORT = String(port);
    testEnv.TEST_DATABASE_URL = `postgresql://renovix:renovix_test@127.0.0.1:${port}/renovix_test`;
    const compose = ["docker", "compose", "-f", "docker-compose.test.yml", "-p", project];
    cleanups.push(async () => {
      console.log(`Test database: removing compose project ${project}`);
      await run([...compose, "down", "-v"], { env: testEnv });
    });
    console.log(`Test database: own compose project ${project} on 127.0.0.1:${port} (removed at the end)`);
    if ((await run([...compose, "up", "-d", "--wait"], { env: testEnv })) !== 0) {
      await cleanup();
      return false;
    }
  }
  const code = await run(["npx", "nx", "run", "api:test", "--skip-nx-cache"], { env: testEnv });
  await cleanup();
  return code === 0;
}

type Err = { key: string; line: string };

/** One tsc program -> errors. Key = file, TS code, first message line (no line:column). */
async function tsc(cwd: string, program: string): Promise<{ errs: Err[]; ok: boolean; raw: string }> {
  if (!existsSync(join(cwd, program))) return { errs: [], ok: true, raw: "" };
  const { code, out } = await capture(["npx", "tsc", "--noEmit", "--pretty", "false", "-p", program], cwd);
  const errs: Err[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^(?:(.+?)\(\d+,\d+\): )?error (TS\d+): (.*)$/);
    if (!m) continue;
    // paths inside messages (node_modules) must not depend on which checkout ran tsc
    const msg = m[3].replaceAll(cwd, "<root>").replaceAll(ROOT, "<root>");
    errs.push({ key: `${program}\t${m[1] ?? ""}\t${m[2]}\t${msg}`, line: line.replaceAll(cwd, ".") });
  }
  return { errs, ok: code === 0 || errs.length > 0, raw: out };
}

async function withBaseline<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const fetched = await capture(["git", "fetch", "origin", "main"], ROOT);
  const ref = await capture(["git", "rev-parse", "--verify", "origin/main"], ROOT);
  if (ref.code !== 0) throw new Error(`no origin/main to compare against (git fetch failed: ${fetched.out.trim()})`);
  if (fetched.code !== 0) console.warn(`warning: git fetch origin main failed, using the local origin/main ref (${ref.out.trim().slice(0, 7)})`);
  const tmp = mkdtempSync(join(tmpdir(), "renovix-check-baseline-"));
  const dir = join(tmp, "wt");
  cleanups.push(async () => {
    for (const nm of ["node_modules", ...readdirSync(join(ROOT, "apps")).map((a) => `apps/${a}/node_modules`)]) {
      rmSync(join(dir, nm), { force: true }); // unlink the symlink only, never the target
    }
    await capture(["git", "worktree", "remove", "--force", dir], ROOT);
    rmSync(tmp, { recursive: true, force: true });
  });
  const add = await capture(["git", "worktree", "add", "--detach", dir, "origin/main"], ROOT);
  if (add.code !== 0) throw new Error(`git worktree add failed: ${add.out}`);
  for (const nm of ["node_modules", ...readdirSync(join(ROOT, "apps")).map((a) => `apps/${a}/node_modules`)]) {
    if (existsSync(join(ROOT, nm))) symlinkSync(join(ROOT, nm), join(dir, nm));
  }
  const gen = await capture(["npx", "prisma", "generate"], dir);
  if (gen.code !== 0) throw new Error(`prisma generate failed in the baseline worktree:\n${gen.out}`);
  console.log(`Baseline: origin/main ${ref.out.trim().slice(0, 7)} in ${dir}`);
  try {
    return await fn(dir);
  } finally {
    await cleanup();
  }
}

async function typecheckStep(): Promise<boolean> {
  for (const p of PROGRAMS) {
    if (!existsSync(join(ROOT, p))) {
      console.error(`Missing tsconfig: ${p}`);
      return false;
    }
  }
  let failed = false;
  const base = await withBaseline(async (dir) => {
    const r: Record<string, Awaited<ReturnType<typeof tsc>>> = {};
    for (const p of PROGRAMS) r[p] = await tsc(dir, p);
    return r;
  });
  for (const p of PROGRAMS) {
    const cur = await tsc(ROOT, p);
    const counts = new Map<string, number>();
    for (const e of base[p].errs) counts.set(e.key, (counts.get(e.key) ?? 0) + 1);
    const known: Err[] = [];
    const fresh: Err[] = [];
    for (const e of cur.errs) {
      const n = counts.get(e.key) ?? 0;
      if (n > 0) {
        counts.set(e.key, n - 1);
        known.push(e);
      } else fresh.push(e);
    }
    console.log(`\n-- ${p}: ${cur.errs.length} error(s), ${known.length} in baseline, ${fresh.length} NEW`);
    if (known.length) console.log("baseline (not failing):\n" + known.map((e) => "  " + e.line).join("\n"));
    if (fresh.length) console.log("NEW:\n" + fresh.map((e) => "  " + e.line).join("\n"));
    if (!cur.ok) console.log(`tsc failed without parseable errors:\n${cur.raw}`);
    if (fresh.length || !cur.ok) failed = true;
  }
  return !failed;
}

const steps: Array<[string, () => Promise<boolean>]> = [
  ["prisma generate", async () => (await run(["bun", "run", "prisma:generate"])) === 0],
  ["prisma validate", async () => (await run(["bunx", "prisma", "validate"])) === 0],
  ["api tests", testStep],
  ["typecheck (vs origin/main baseline)", typecheckStep],
];

const started = Date.now();
const results: Array<[string, boolean]> = [];
for (const [name, fn] of steps) {
  console.log(`\n========== ${name} ==========`);
  let ok = false;
  try {
    ok = await fn();
  } catch (e) {
    console.error(`${name}: ${e instanceof Error ? e.message : e}`);
  }
  await cleanup();
  results.push([name, ok]);
}

console.log("\n========== summary ==========");
for (const [name, ok] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
const failedNames = results.filter(([, ok]) => !ok).map(([n]) => n);
console.log(`(${Math.round((Date.now() - started) / 1000)}s)`);
if (failedNames.length) {
  console.error(`check FAILED: ${failedNames.join(", ")}`);
  process.exit(1);
}
console.log("check passed");
