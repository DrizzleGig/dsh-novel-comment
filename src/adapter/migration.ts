import path from "node:path";
import { copyFile, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { sha256Hex } from "../reader/index.ts";
import { READER_DATA_DIR } from "./storage.ts";

/**
 * v0.1 → v2 迁移。
 *
 * 规则（Codex 设计）：
 * - 一次性、显式；先 plan（可重复 dry-run），再按 planHash apply；
 * - 不改写旧文件：原样备份到 `legacy/v0.1/`，旧路径保留；
 * - 旧评审没有正文、版本、前驱记忆 → 只归档，标 `legacy-unverifiable`，
 *   **不伪造星级、不伪造记忆、不折算成有效评分**；
 * - 迁移中源文件变了 → 中止。
 */

export interface MigrationPlan {
  planHash: string;
  sourceRoot: string;
  profiles: number;
  reviews: number;
  unverifiable: number;
  alreadyMigrated: boolean;
  blocked: string[];
  sources: Array<{ path: string; sha256: string }>;
}

export interface MigrationResult {
  applied: boolean;
  planHash: string;
  archived: number;
  manifestPath: string | null;
  reason?: string;
}

const LEGACY_DIR = "legacy";
const RECORD_FILE = "migration-v01.json";

async function sha256File(file: string): Promise<string> {
  return sha256Hex(await readFile(file, "utf8"));
}

async function collectSources(root: string): Promise<Array<{ path: string; sha256: string }>> {
  const out: Array<{ path: string; sha256: string }> = [];
  const profiles = path.join(root, "profiles.json");
  if (existsSync(profiles)) out.push({ path: "profiles.json", sha256: await sha256File(profiles) });
  const reviewsDir = path.join(root, "reviews");
  if (existsSync(reviewsDir)) {
    const names = (await readdir(reviewsDir)).filter((n) => n.endsWith(".json")).sort();
    for (const name of names) {
      out.push({ path: `reviews/${name}`, sha256: await sha256File(path.join(reviewsDir, name)) });
    }
  }
  return out;
}

function hashPlan(sources: Array<{ path: string; sha256: string }>): string {
  return sha256Hex(sources.map((s) => `${s.path}:${s.sha256}`).join("\n"));
}

async function readRecord(root: string): Promise<{ planHash: string; at: string } | null> {
  const file = path.join(root, LEGACY_DIR, RECORD_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as { planHash: string; at: string };
  } catch {
    return null;
  }
}

export async function planLegacyMigration(workspaceRoot: string): Promise<MigrationPlan> {
  const root = path.join(workspaceRoot, READER_DATA_DIR);
  const sources = await collectSources(root);
  const planHash = hashPlan(sources);
  const record = await readRecord(root);
  const blocked: string[] = [];
  const reviews = sources.filter((s) => s.path.startsWith("reviews/")).length;
  const profiles = sources.some((s) => s.path === "profiles.json") ? 1 : 0;

  // 旧评审无法验证：没有正文、没有版本、没有前驱记忆
  const unverifiable = reviews;
  if (reviews > 0) {
    blocked.push("旧评审只做归档（legacy-unverifiable），不会折算成星级，也不会生成记忆");
  }
  if (sources.length === 0) {
    blocked.push("没有找到 v0.1 数据（profiles.json / reviews/）");
  }

  return {
    planHash,
    sourceRoot: root,
    profiles,
    reviews,
    unverifiable,
    alreadyMigrated: record !== null && record.planHash === planHash,
    blocked,
    sources,
  };
}

export async function applyLegacyMigration(workspaceRoot: string, planHash: string): Promise<MigrationResult> {
  const root = path.join(workspaceRoot, READER_DATA_DIR);
  const plan = await planLegacyMigration(workspaceRoot);
  if (plan.planHash !== planHash) {
    return {
      applied: false,
      planHash,
      archived: 0,
      manifestPath: null,
      reason: "源文件在 plan 之后发生变化，迁移中止（请重新 plan）",
    };
  }
  if (plan.sources.length === 0) {
    return { applied: false, planHash, archived: 0, manifestPath: null, reason: "没有可迁移的 v0.1 数据" };
  }
  const record = await readRecord(root);
  if (record && record.planHash === planHash) {
    return { applied: false, planHash, archived: 0, manifestPath: null, reason: "同一计划已迁移过（幂等返回）" };
  }
  const legacyRoot = path.join(root, LEGACY_DIR, "v0.1");
  // 迁移互斥：并发第二个进程直接拒绝，避免检查与复制之间的窗口
  const lockFile = path.join(root, LEGACY_DIR, ".migration.lock");
  await mkdir(path.dirname(lockFile), { recursive: true });
  let lockHandle: Awaited<ReturnType<typeof open>>;
  try {
    lockHandle = await open(lockFile, "wx");
  } catch {
    return { applied: false, planHash, archived: 0, manifestPath: null, reason: "另一个迁移正在进行，拒绝并发执行" };
  }
  try {
    if (existsSync(legacyRoot)) {
      const existing = await readdir(legacyRoot).catch(() => [] as string[]);
      if (existing.length > 0) {
        return {
          applied: false,
          planHash,
          archived: 0,
          manifestPath: null,
          reason: "legacy/v0.1 已有归档快照，拒绝覆盖（不同计划请另建目录，或人工确认后清理）",
        };
      }
    }
    await mkdir(legacyRoot, { recursive: true });
    let archived = 0;
    for (const source of plan.sources) {
      const from = path.join(root, source.path);
      const to = path.join(legacyRoot, source.path);
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(from, to);
      // 复制后校验副本哈希，防止复制期间源变化或写入不完整
      if ((await sha256File(to)) !== source.sha256) {
        return {
          applied: false,
          planHash,
          archived,
          manifestPath: null,
          reason: `归档副本哈希与计划不一致：${source.path}（复制期间源可能变化）`,
        };
      }
      archived++;
    }
    const manifestPath = path.join(root, LEGACY_DIR, RECORD_FILE);
    const manifest = {
      schemaVersion: 2,
      planHash,
      at: new Date().toISOString(),
      note: "v0.1 数据已原样备份；旧评审标为 legacy-unverifiable，不折算成星级",
      sources: plan.sources,
    };
    await mkdir(path.dirname(manifestPath), { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return { applied: true, planHash, archived, manifestPath };
  } finally {
    await lockHandle.close().catch(() => undefined);
    await unlink(lockFile).catch(() => undefined);
  }
}
