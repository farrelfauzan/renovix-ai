// Helper rule check (RX-130, AGENTS.md "Helpers"), a step of `bun run check`.
// Reads the services, controllers, guards and schedulers of apps/api/src (`*.service.ts`, `*.controller.ts`,
// `*.guard.ts`, `*.scheduler.ts`; spec files are not read) with the TypeScript parser and looks at every class
// method that has a body, static and private ones too. Constructors, get/set accessors and class properties are
// not looked at. A method whose body holds no `this` (or `super`) uses nothing injected: it fails the check,
// named by file and Class.method, unless it is listed with its reason in scripts/helper-rule-exceptions.ts.
// A list entry that matches no such method any more fails too, so the list can only shrink.
// Only test 1 of the helper rule is checked here; tests 2 and 3 are judged by reading the code.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { HELPER_RULE_EXCEPTIONS } from "./helper-rule-exceptions";

const ROOT = resolve(import.meta.dir, "..");
const SRC = "apps/api/src";
const IN_SCOPE = /\.(service|controller|guard|scheduler)\.ts$/;

function usesThis(node: ts.Node): boolean {
  if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword) return true;
  return ts.forEachChild(node, usesThis) ?? false;
}

const files = (readdirSync(join(ROOT, SRC), { recursive: true }) as string[]).filter((f) => IN_SCOPE.test(f) && !f.startsWith("generated/")).sort();
const found: string[] = [];
for (const file of files) {
  const source = ts.createSourceFile(file, readFileSync(join(ROOT, SRC, file), "utf8"), ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isClassLike(node)) {
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.body && !usesThis(member.body)) found.push(`${SRC}/${file} ${node.name?.text}.${member.name.getText()}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const unlisted = found.filter((m) => !(m in HELPER_RULE_EXCEPTIONS));
const stale = Object.keys(HELPER_RULE_EXCEPTIONS).filter((m) => !found.includes(m));
if (unlisted.length) {
  console.error(`Helper rule: ${unlisted.length} method(s) use nothing injected (no \`this\`) and are not on the exception list:`);
  for (const m of unlisted) console.error(`  ${m}`);
  console.error("Move each to the utils/ folder of its module, one function per file (see AGENTS.md), or list it with its reason in scripts/helper-rule-exceptions.ts.");
}
if (stale.length) {
  console.error(`Helper rule: ${stale.length} exception(s) match no method without \`this\` any more:`);
  for (const m of stale) console.error(`  ${m}`);
  console.error("Remove each from scripts/helper-rule-exceptions.ts.");
}
if (unlisted.length || stale.length) process.exit(1);
console.log(`Helper rule: no new method without \`this\` in ${files.length} files (${found.length} on the exception list).`);
