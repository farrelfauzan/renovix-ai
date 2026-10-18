// Module layout check (RX-128, AGENTS.md "API module layout"), a step of `bun run check`.
// Rule 1: fails and names the file when a source file lies directly in a feature module folder of apps/api/src/app:
// only the `*.module.ts` file may stay at the module root, everything else goes into a folder
// (controller/, service/, repository/, dto/, or a folder named for the kind of file).
// Rule 2 (RX-184, Tech Lead decision 2a): fails and names any `**/controller/*.controller.ts` that defines a
// Zod schema inline (`z.object(`, `z.strictObject(`, `z.looseObject(`, any spacing); request schemas live in the module's dto/ folder.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const APP = "apps/api/src/app";
// Folders of apps/api/src/app that are not feature modules: infrastructure shared by the modules.
// Every other folder is a feature module.
const NOT_FEATURE_MODULES = ["prisma", "config", "providers", "google-storage"];

const stray: string[] = [];
for (const dir of readdirSync(join(ROOT, APP), { withFileTypes: true })) {
  if (!dir.isDirectory() || NOT_FEATURE_MODULES.includes(dir.name)) continue;
  for (const file of readdirSync(join(ROOT, APP, dir.name), { withFileTypes: true })) {
    if (file.isFile() && /\.[cm]?[jt]s$/.test(file.name) && !file.name.endsWith(".module.ts")) stray.push(`${APP}/${dir.name}/${file.name}`);
  }
}

// Every `*.controller.ts` directly inside a `controller/` folder anywhere under apps/api/src/app.
const controllerFiles = readdirSync(join(ROOT, APP), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".controller.ts") && entry.parentPath.endsWith("/controller"))
  .map((entry) => join(entry.parentPath, entry.name));

/** The Zod schema shapes a controller must not define inline: z.object, z.strictObject, z.looseObject,
 *  with any spacing before the parenthesis (`z.object (`, `z.strictObject (`… all match). Comments are
 *  stripped first so the rule flags only code: a comment saying "no z.object( here" does not trip it. */
const INLINE_SCHEMA_PATTERN = /\bz\.(object|strictObject|looseObject)\s*\(/;

/** The file's comments replaced by spaces (line/column-preserving), so the pattern matches code
 *  only: a comment mentioning a schema call does not trip the rule. String and template literals
 *  are honoured first — a `//` inside a URL ("http://…") or a comment-like string is not a comment,
 *  so code after it on the same line is still checked. */
function stripComments(text: string): string {
  let result = "";
  let state: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  for (let i = 0; i < text.length; i += 1) {
    const two = text.slice(i, i + 2);
    if (state === "code") {
      if (two === "//") {
        state = "line";
        result += "  ";
        i += 1;
      } else if (two === "/*") {
        state = "block";
        result += "  ";
        i += 1;
      } else if (text[i] === "'") {
        state = "single";
        result += text[i];
      } else if (text[i] === '"') {
        state = "double";
        result += text[i];
      } else if (text[i] === "`") {
        state = "template";
        result += text[i];
      } else result += text[i];
    } else if (state === "line") {
      result += text[i] === "\n" ? "\n" : " ";
      if (text[i] === "\n") state = "code";
    } else if (state === "block") {
      result += text[i] === "\n" ? "\n" : " ";
      if (two === "*/") {
        state = "code";
        result = result.slice(0, -1) + " ";
        i += 1;
      }
    } else {
      result += text[i];
      const quote = state === "single" ? "'" : state === "double" ? '"' : "`";
      if (text[i] === "\\") {
        // an escaped character inside the literal: copy the next character too
        result += text[i + 1] ?? "";
        i += 1;
      } else if (text[i] === quote) state = "code";
    }
  }
  return result;
}

const inlineSchemas = controllerFiles
  .filter((file) => INLINE_SCHEMA_PATTERN.test(stripComments(readFileSync(file, "utf8"))))
  .map((file) => file.slice(ROOT.length + 1));

if (stray.length) {
  console.error(`Module layout: ${stray.length} source file(s) lie directly in a feature module folder:`);
  for (const f of stray) console.error(`  ${f}`);
  console.error("Move each into controller/, service/, repository/, dto/ or a folder named for its kind (see AGENTS.md).");
}
for (const f of inlineSchemas) {
  console.error(`Zod schemas must not live in controller files: ${f} defines a z.object schema inline; move it to the module's dto/ folder (RX-184, decision 2a).`);
}
if (stray.length || inlineSchemas.length) process.exit(1);
console.log("Module layout: no source file lies directly in a feature module folder; no controller defines a Zod schema inline.");
