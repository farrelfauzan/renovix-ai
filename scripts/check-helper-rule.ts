// Helper rule check (RX-130, RX-131, AGENTS.md "Helpers"), a step of `bun run check`.
// Reads the services, controllers, guards and schedulers of apps/api/src (`*.service.ts`, `*.controller.ts`,
// `*.guard.ts`, `*.scheduler.ts`; spec files and the generated client are not read) with the TypeScript parser.
// It looks at two things:
//   1. Every class method that has a body, static and private ones too. A method whose body holds no `this`
//      (or `super`) uses nothing injected. Key: "<file> <Class>.<method>".
//   2. Every function written outside a class at the top level of the file, exported or not:
//      `function f() {}` (and `async function`) and a `const`, `let` or `var` whose initializer is itself an
//      arrow function or a function expression (`const f = () => ...`, `const f = function () {}`). Each one
//      counts, whether or not it uses `this`. Key: "<file> <name>" (no class, no dot).
// Each one found fails the check, named by its key, unless scripts/helper-rule-exceptions.ts lists it with its
// reason. A list entry that matches nothing found fails too, so the list can only shrink.
// Not looked at: constructors, get/set accessors, class properties (also a property holding an arrow function,
// `f = () => {}`), methods and arrow functions inside an object literal, functions nested inside another
// function or method, functions inside a block or namespace, a function declaration without a body (overload,
// `declare`), an unnamed `export default function`, a destructured name, and a function wrapped in another
// expression (`const f = (() => 1) as X`, `const f = memoize(() => 1)`).
// Only test 1 of the helper rule is checked here (for top-level functions: that they exist); tests 2 and 3 are
// judged by reading the code.
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
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.body && statement.name) found.push(`${SRC}/${file} ${statement.name.text}`);
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && ts.isIdentifier(declaration.name)) found.push(`${SRC}/${file} ${declaration.name.text}`);
    }
  }
}

const unlisted = found.filter((m) => !(m in HELPER_RULE_EXCEPTIONS));
const stale = Object.keys(HELPER_RULE_EXCEPTIONS).filter((m) => !found.includes(m));
if (unlisted.length) {
  console.error(`Helper rule: ${unlisted.length} function(s) outside a class, or method(s) that use nothing injected (no \`this\`), not on the exception list:`);
  for (const m of unlisted) console.error(`  ${m}`);
  console.error("Move each to the utils/ folder of its module, one function per file (see AGENTS.md), or list it with its reason in scripts/helper-rule-exceptions.ts.");
}
if (stale.length) {
  console.error(`Helper rule: ${stale.length} exception(s) match no method without \`this\` and no function outside a class any more:`);
  for (const m of stale) console.error(`  ${m}`);
  console.error("Remove each from scripts/helper-rule-exceptions.ts.");
}
if (unlisted.length || stale.length) process.exit(1);
console.log(`Helper rule: no new method without \`this\` and no new function outside a class in ${files.length} files (${found.length} on the exception list).`);
