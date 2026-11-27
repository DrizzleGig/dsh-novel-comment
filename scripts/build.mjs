import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// esbuild 会读取上级 package.json；空白文件会让它报 Unexpected end of file in JSON。
const parent = path.join(path.dirname(root), "package.json");
if (!existsSync(parent) || readFileSync(parent, "utf8").trim() === "") {
  writeFileSync(parent, "{}\n", "utf8");
}

const esbuild = path.join(root, "node_modules", "esbuild", "bin", "esbuild");
const result = spawnSync(process.execPath, [
  esbuild,
  "src/adapter/index.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--outfile=lib/reader-core.mjs",
  "--external:node:*",
  "--log-level=warning",
], { cwd: root, stdio: "inherit" });

process.exit(result.status ?? 1);
