// Prisma import check (RX-132, AGENTS.md "Repositories"), a step of `bun run check`.
// Only a repository (`<module>/repository/*.repository.ts`) and the Prisma module (`apps/api/src/app/prisma/`)
// may import PrismaService or the generated Prisma client. Every other source file of apps/api/src is read with
// the TypeScript parser (spec files and the generated client are not read; `apps/api/test` and the seed lie
// outside). A file that has such an import fails the check, named, unless scripts/prisma-import-exceptions.ts
// lists it. `import type` is allowed everywhere: a service has to name the row types a repository returns.
// The list may only shrink: an entry that no longer has such an import fails, and so does an entry that the
// list on the base branch does not have, unless git sees the file as renamed from a listed one. The base branch
// is the ref given as the first argument, else the env PRISMA_IMPORTS_BASE (RX-133: lets `bun run check`, which
// passes no argument, be run against another base), else origin/main. When the list of the base branch cannot
// be read (the ref does not exist in this checkout, or it has no scripts/prisma-import-exceptions.ts), the check
// fails and says which (RX-133); it no longer skips the rule.
// Not looked at: `require()`, `import x = require()` and dynamic `import()` (none exist in apps/api/src), and
// `@prisma/client` itself (the client is generated into apps/api/src/generated). Not seen at all: a service that
// runs a query on the transaction it gets from TransactionService.run; that needs no import, so review holds it.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { PRISMA_IMPORT_EXCEPTIONS } from "./prisma-import-exceptions";

const ROOT = resolve(import.meta.dir, "..");
const SRC = "apps/api/src";
const LIST = "scripts/prisma-import-exceptions.ts";
const BASE = process.argv[2] || process.env.PRISMA_IMPORTS_BASE || "origin/main";
const ALLOWED = /^apps\/api\/src\/app\/(prisma\/|[^/]+\/repository\/[^/]+\.repository\.ts$)/;
const FORBIDDEN = /(^|\/)prisma\/prisma\.service(\.[cm]?[jt]s)?$|^\.\/prisma\.service(\.[cm]?[jt]s)?$|(^@|\/)generated\/prisma(\/|$)/;

function git(args: string[]): { ok: boolean; out: string } {
  const r = Bun.spawnSync(["git", ...args], { cwd: ROOT });
  return { ok: r.exitCode === 0, out: r.stdout.toString() };
}

function hasForbiddenImport(file: string): boolean {
  const source = ts.createSourceFile(file, readFileSync(join(ROOT, file), "utf8"), ts.ScriptTarget.Latest, true);
  return source.statements.some((s) => {
    if (!(ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) || !s.moduleSpecifier || !ts.isStringLiteral(s.moduleSpecifier)) return false;
    if (!FORBIDDEN.test(s.moduleSpecifier.text)) return false;
    if (ts.isExportDeclaration(s)) return !s.isTypeOnly;
    const clause = s.importClause;
    if (!clause) return true; // side-effect import
    if (clause.isTypeOnly) return false;
    const named = clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : undefined;
    return !!clause.name || !named || named.some((e) => !e.isTypeOnly);
  });
}

const files = (readdirSync(join(ROOT, SRC), { recursive: true }) as string[])
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts") && !f.endsWith(".d.ts") && !f.startsWith("generated/"))
  .map((f) => `${SRC}/${f}`)
  .filter((f) => !ALLOWED.test(f))
  .sort();
const found = files.filter(hasForbiddenImport);
const unlisted = found.filter((f) => !PRISMA_IMPORT_EXCEPTIONS.includes(f));
const stale = PRISMA_IMPORT_EXCEPTIONS.filter((f) => !found.includes(f));

let added: string[] = [];
const baseList = git(["show", `${BASE}:${LIST}`]);
if (baseList.ok) {
  const onBase = new Set([...baseList.out.matchAll(/"(apps\/api\/src\/[^"]+)"/g)].map((m) => m[1]));
  const renamedFrom = new Map<string, string>();
  for (const line of git(["diff", "-M", "--diff-filter=R", "--name-status", BASE]).out.split("\n")) {
    const [, from, to] = line.split("\t");
    if (to) renamedFrom.set(to, from);
  }
  added = PRISMA_IMPORT_EXCEPTIONS.filter((f) => !onBase.has(f) && !onBase.has(renamedFrom.get(f) ?? ""));
}

if (unlisted.length) {
  console.error(`Prisma imports: ${unlisted.length} file(s) outside a repository import PrismaService or the generated Prisma client:`);
  for (const f of unlisted) console.error(`  ${f}`);
  console.error("Reach the database through a repository (see AGENTS.md); do not add the file to scripts/prisma-import-exceptions.ts.");
}
if (stale.length) {
  console.error(`Prisma imports: ${stale.length} listed file(s) no longer import PrismaService or the generated Prisma client:`);
  for (const f of stale) console.error(`  ${f}`);
  console.error("Remove each from scripts/prisma-import-exceptions.ts.");
}
if (added.length) {
  console.error(`Prisma imports: ${added.length} file(s) were added to the list (not on the list of ${BASE}); the list may only shrink:`);
  for (const f of added) console.error(`  ${f}`);
}
if (!baseList.ok) {
  const why = git(["rev-parse", "--verify", "--quiet", `${BASE}^{commit}`]).ok
    ? `${BASE} has no ${LIST}`
    : `${BASE} is not a commit in this checkout (fetch it, or name another base)`;
  console.error(`Prisma imports: cannot read the exception list of the base branch, so additions to the list cannot be checked: ${why}.`);
}
if (unlisted.length || stale.length || added.length || !baseList.ok) process.exit(1);
console.log(`Prisma imports: no new import outside a repository in ${files.length} files (${found.length} on the exception list; compared with the list of ${BASE}).`);
