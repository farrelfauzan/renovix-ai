// Module layout check (RX-128, AGENTS.md "API module layout"), a step of `bun run check`.
// Rule 1: fails and names the file when a source file lies directly in a feature module folder of apps/api/src/app:
// only the `*.module.ts` file may stay at the module root, everything else goes into a folder
// (controller/, service/, repository/, dto/, or a folder named for the kind of file).
// Rule 2 (RX-184, Tech Lead decision 2a): fails and names any `**/controller/*.controller.ts` that defines a
// Zod schema inline (`z.object(`); request schemas live in the module's dto/ folder.
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
const inlineSchemas = controllerFiles
  .filter((file) => readFileSync(file, "utf8").includes("z.object("))
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
