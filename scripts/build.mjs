import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// esbuild 会读取上级 package.json；空白文件会让它报 Unexpected end of file in JSON。
const parent = path.join(path.dirname(root), "package.json");
if (!existsSync(parent) || readFileSync(parent, "utf8").trim() === "") {
  writeFileSync(parent, "{}\n", "utf8");
}

const esbuild = path.join(root, "node_modules", "esbuild", "bin", "esbuild");

function run(args) {
  return spawnSync(process.execPath, [esbuild, ...args], { cwd: root, stdio: "inherit" });
}

// 1) 领域引擎 → lib/reader-core.mjs
const core = run([
  "src/adapter/index.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--outfile=lib/reader-core.mjs",
  "--external:node:*",
  "--log-level=warning",
]);
if (core.status !== 0) process.exit(core.status ?? 1);

// 2) 标签目录 → client.js 里的构建期常量（面板不依赖 remote.tags 也能显示全部标签）
const tagsTemp = path.join(root, "lib", ".tags-runtime.mjs");
const tagsBuild = run([
  "src/reader/tags.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  `--outfile=${path.relative(root, tagsTemp)}`,
  "--log-level=warning",
]);
if (tagsBuild.status !== 0) process.exit(tagsBuild.status ?? 1);

const catalog = (await import(pathToFileURL(tagsTemp).href)).tagCatalog();
const json = JSON.stringify(catalog);
const clientPath = path.join(root, "client.js");
const source = readFileSync(clientPath, "utf8");
const marker = /\/\* TAG_CATALOG_BEGIN \*\/[\s\S]*?\/\* TAG_CATALOG_END \*\//u;
if (!marker.test(source)) {
  console.error("client.js 缺少 TAG_CATALOG 标记，无法写入标签目录");
  process.exit(1);
}
const next = source.replace(marker, `/* TAG_CATALOG_BEGIN */${json}/* TAG_CATALOG_END */`);
if (next !== source) writeFileSync(clientPath, next, "utf8");
rmSync(tagsTemp, { force: true });

process.exit(0);
