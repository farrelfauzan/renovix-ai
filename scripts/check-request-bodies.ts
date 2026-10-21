// Request body check (RNX-28, D237), a step of `bun run check`.
// Reads every `*.controller.ts` of apps/api/src (spec files and the generated client are not read) with the
// TypeScript parser. For every parameter of a class method decorated with `@Body(...)`, it fails and names
// `<file>:<line> <Class>.<method>(<parameter>)` with the reason, unless all four hold:
//   1. The parameter's type is written and is `unknown`. A missing type (implicitly `any`), `any`, an inline
//      type (`{ amount?: number }`) or a named type (`CreateXDto`) fails: a type written on the parameter is
//      a claim nothing checks.
//   2. The method passes the parameter to a `<Schema>.safeParse(...)` call as its first argument, either
//      alone (`safeParse(body)`) or with a default (`safeParse(body ?? {})`). The call may be anywhere in the
//      method, also after other checks (a signature check, a role check).
//   3. `<Schema>` is imported from a module's dto/ folder (an import path containing `/dto/`), where the
//      request schemas live (the module layout check already refuses a schema written in a controller).
//   4. The method calls `createInvalidBodyException(...)` (apps/api/src/common/utils), the one helper that
//      builds the 400 for an invalid body, so every route refuses a body in the same shape.
// There is no exception list. An optional first argument names another checkout root to read (e.g. a scratch copy).
// Not looked at: a body read through `@Req()` as `req.body` (the Better Auth proxy forwards the raw body on
// purpose), what the method does with the parameter before it is parsed, and whether the helper is thrown
// on the parse failure itself (the route specs check the answer).
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(process.argv[2] ?? join(import.meta.dir, ".."));
const SRC = "apps/api/src";
const HELPER = "createInvalidBodyException";

/** Whether a parameter carries a `@Body(...)` decorator. */
function isBodyParameter(parameter: ts.ParameterDeclaration): boolean {
  return (ts.getDecorators(parameter) ?? []).some((d) => ts.isCallExpression(d.expression) && d.expression.expression.getText() === "Body");
}

/** The `<Schema>` identifiers of the `<Schema>.safeParse(<name>)` and `<Schema>.safeParse(<name> ?? ...)` calls in a node. */
function findSafeParseSchemas(node: ts.Node, name: string): string[] {
  const found: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "safeParse") {
      const first = n.arguments[0];
      const arg = first && ts.isBinaryExpression(first) && first.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ? first.left : first;
      if (arg && ts.isIdentifier(arg) && arg.text === name) found.push(n.expression.expression.getText());
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Whether a node holds a call of the invalid-body helper. */
function callsHelper(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && node.expression.getText() === HELPER) return true;
  return ts.forEachChild(node, callsHelper) ?? false;
}

/** The import path of each name a file imports. */
function readImports(source: ts.SourceFile): Map<string, string> {
  const imports = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const e of bindings.elements) imports.set(e.name.text, statement.moduleSpecifier.text);
  }
  return imports;
}

/** Why a `@Body()` parameter of a method fails the rule, or undefined when it passes. */
function findProblem(method: ts.MethodDeclaration, parameter: ts.ParameterDeclaration, imports: Map<string, string>): string | undefined {
  const name = parameter.name.getText();
  if (!parameter.type) return "has no type (implicitly any); type it `unknown` and parse it";
  if (parameter.type.kind !== ts.SyntaxKind.UnknownKeyword) return `is typed \`${parameter.type.getText().replace(/\s+/g, " ")}\`, not \`unknown\`; type it \`unknown\` and parse it`;
  const schemas = method.body ? findSafeParseSchemas(method.body, name) : [];
  if (schemas.length === 0) return `is never passed to a \`.safeParse(${name})\``;
  const outside = schemas.filter((s) => !imports.get(s)?.includes("/dto/"));
  if (outside.length === schemas.length) return `is parsed with \`${outside.join("`, `")}\`, which is not imported from a dto/ folder`;
  if (!callsHelper(method.body!)) return `is parsed, but the method never calls ${HELPER}() for the 400`;
  return undefined;
}

const files = (readdirSync(join(ROOT, SRC), { recursive: true }) as string[]).filter((f) => f.endsWith(".controller.ts") && !f.startsWith("generated/")).sort();
const problems: string[] = [];
let bodies = 0;
for (const file of files) {
  const source = ts.createSourceFile(file, readFileSync(join(ROOT, SRC, file), "utf8"), ts.ScriptTarget.Latest, true);
  const imports = readImports(source);
  const visit = (node: ts.Node): void => {
    if (ts.isClassLike(node)) {
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        for (const parameter of member.parameters.filter(isBodyParameter)) {
          bodies += 1;
          const problem = findProblem(member, parameter, imports);
          const line = source.getLineAndCharacterOfPosition(parameter.getStart()).line + 1;
          if (problem) problems.push(`${SRC}/${file}:${line} ${node.name?.text}.${member.name.getText()}(${parameter.name.getText()}) ${problem}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (problems.length) {
  console.error(`Request bodies: ${problems.length} @Body() parameter(s) not typed \`unknown\` and parsed with a dto/ schema and ${HELPER}():`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("Type the parameter `unknown`, parse it with its module's dto/ schema (`safeParse`) and throw createInvalidBodyException(parsed.error) when it fails.");
  process.exit(1);
}
console.log(`Request bodies: all ${bodies} @Body() parameters in ${files.length} controllers are typed \`unknown\`, parsed with a dto/ schema and refused with ${HELPER}().`);
