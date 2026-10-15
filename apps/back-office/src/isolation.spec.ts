/** @jest-environment node */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const APPS = resolve(__dirname, "../..");
const SKIPPED = new Set(["node_modules", ".next", "dist", "test-output"]);

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIPPED.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

describe("back-office isolation (RX-93)", () => {
  it.each(["chat", "landing"])("nothing in apps/%s refers to the back-office", (app) => {
    const mentions = listFiles(join(APPS, app))
      .filter((file) => /\.(ts|tsx|js|jsx|json|css|mjs|cjs)$/.test(file))
      .filter((file) => /back-office|backoffice/i.test(readFileSync(file, "utf8")));
    expect(mentions).toEqual([]);
  });

  it("the root tsconfig.base.json maps no path to the back-office", () => {
    expect(readFileSync(resolve(APPS, "../tsconfig.base.json"), "utf8")).not.toMatch(/back-office/);
  });
});
