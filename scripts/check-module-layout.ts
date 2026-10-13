// Module layout check (RX-128, AGENTS.md "API module layout"), a step of `bun run check`.
// Fails and names the file when a source file lies directly in a feature module folder of apps/api/src/app:
// only the `*.module.ts` file may stay at the module root, everything else goes into a folder
// (controller/, service/, repository/, dto/, or a folder named for the kind of file).
import { readdirSync } from "node:fs";
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

if (stray.length) {
  console.error(`Module layout: ${stray.length} source file(s) lie directly in a feature module folder:`);
  for (const f of stray) console.error(`  ${f}`);
  console.error("Move each into controller/, service/, repository/, dto/ or a folder named for its kind (see AGENTS.md).");
  process.exit(1);
}
console.log("Module layout: no source file lies directly in a feature module folder.");
