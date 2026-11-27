import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith(".test.ts") || name.endsWith(".test.mjs") || name === "smoke.mjs") files.push(full);
  }
}
walk(path.join(root, "test"));

const result = spawnSync(process.execPath, ["--test", "--experimental-strip-types", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
