import path from "node:path";
import { mkdir, readFile, readdir, rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { ChapterRating, ReadingMemory, ReviewMemory } from "../core/index.ts";
import { atomicWrite } from "./storage.ts";

/**
 * 提交日志：把「一次阅读」要改的多份数据先写成一条 pending run，
 * 再依次应用（记忆 → 配额 → 幂等回执），全部成功后删除。
 *
 * 崩溃恢复规则：
 *  - 重放按 `seq` 升序，旧日志不能把较新的进度覆盖回去；
 *  - 配额按 txId 去重（账本记 `appliedTx`），重复重放不会重复计费；
 *  - 结构不合法/重放失败的日志移入 `journal/failed/`，不阻塞后续启动。
 */
export interface RunUsageDelta {
  chapters: number;
  words: number;
  tokens: number;
  /** 用量未知（只记 unknown，不重复加 token） */
  unknown: boolean;
}

export interface JournalRun {
  schemaVersion: 2;
  /** 单调递增的提交序号（同一毫秒内用随机后缀区分文件名） */
  seq: number;
  txId: string;
  kind: "read-chapter" | "review-chapter";
  at: string;
  readerId: string;
  bookId: string;
  memory: ReadingMemory;
  usage: { date: string; delta: RunUsageDelta };
  /** review-chapter：同一次提交里要落盘的评分与评审链记忆 */
  rating?: ChapterRating;
  reviewMemoryAfter?: ReviewMemory;
  requestId?: string;
}

const PENDING = "journal/pending";
const FAILED = "journal/failed";

export function journalPendingDir(root: string): string {
  return path.join(root, PENDING);
}

export async function writeJournalRun(root: string, run: JournalRun): Promise<string> {
  const file = path.join(root, PENDING, `${String(run.seq).padStart(16, "0")}-${run.txId}.json`);
  await atomicWrite(file, `${JSON.stringify(run, null, 2)}\n`);
  return file;
}

function isReadingMemory(value: unknown): value is ReadingMemory {
  const memory = value as Partial<ReadingMemory> | null;
  if (!memory || typeof memory !== "object") return false;
  if (memory.schemaVersion !== 2) return false;
  if (typeof memory.id !== "string" || typeof memory.readerId !== "string" || typeof memory.bookId !== "string") return false;
  if (typeof memory.readThrough !== "number" || !Number.isInteger(memory.readThrough) || memory.readThrough < 0) return false;
  if (!Array.isArray(memory.characters)) return false;
  for (const character of memory.characters) {
    if (!character || typeof character.name !== "string" || typeof character.belief !== "string") return false;
    if (character.confidence !== "observed" && character.confidence !== "inferred") return false;
  }
  if (!Array.isArray(memory.expectations) || !memory.expectations.every((x) => typeof x === "string")) return false;
  if (typeof memory.emotionalTone !== "string") return false;
  if (!Array.isArray(memory.unreadQuestions) || !memory.unreadQuestions.every((x) => typeof x === "string")) return false;
  if (typeof memory.fatigueCounter !== "number" || !Number.isFinite(memory.fatigueCounter)) return false;
  if (!(memory.droppedReason === null || typeof memory.droppedReason === "string")) return false;
  if (typeof memory.updatedAt !== "string") return false;
  return true;
}

function isReviewMemory(value: unknown): value is ReviewMemory {
  const memory = value as Partial<ReviewMemory> | null;
  if (!memory || typeof memory !== "object") return false;
  if (memory.schemaVersion !== 2) return false;
  if (typeof memory.id !== "string" || typeof memory.readerId !== "string" || typeof memory.bookId !== "string") return false;
  if (typeof memory.generation !== "number" || typeof memory.validThrough !== "number") return false;
  if (!(memory.invalidFrom === null || typeof memory.invalidFrom === "number")) return false;
  if (!Array.isArray(memory.entries)) return false;
  for (const entry of memory.entries) {
    if (!entry || typeof entry.chapterNumber !== "number" || typeof entry.memory !== "string") return false;
  }
  if (typeof memory.updatedAt !== "string") return false;
  return true;
}

function isChapterRating(value: unknown): value is ChapterRating {
  const rating = value as Partial<ChapterRating> | null;
  if (!rating || typeof rating !== "object") return false;
  if (rating.schemaVersion !== 2) return false;
  if (typeof rating.id !== "string" || typeof rating.readerId !== "string") return false;
  if (!rating.target || typeof rating.target !== "object") return false;
  if (typeof rating.target.bookId !== "string" || typeof rating.target.chapterId !== "string") return false;
  if (typeof rating.stars !== "number" || !Number.isInteger(rating.stars) || rating.stars < 1 || rating.stars > 5) return false;
  if (typeof rating.chapterComment !== "string" || rating.chapterComment.length === 0) return false;
  if (!Array.isArray(rating.segmentComments)) return false;
  if (rating.status !== "follow" && rating.status !== "watch" && rating.status !== "drop") return false;
  return true;
}

function isJournalRun(value: unknown): value is JournalRun {
  const run = value as Partial<JournalRun> | null;
  if (!run || typeof run !== "object") return false;
  if (run.schemaVersion !== 2) return false;
  if (run.kind !== "read-chapter" && run.kind !== "review-chapter") return false;
  if (typeof run.seq !== "number" || !Number.isFinite(run.seq)) return false;
  if (typeof run.txId !== "string" || run.txId.length === 0) return false;
  if (typeof run.readerId !== "string" || typeof run.bookId !== "string") return false;
  if (!isReadingMemory(run.memory)) return false;
  // 身份必须自洽：避免用 A 读者的日志写进 B 读者的记忆
  if (run.memory.readerId !== run.readerId || run.memory.bookId !== run.bookId) return false;
  if (run.kind === "review-chapter") {
    if (!isChapterRating(run.rating)) return false;
    if (run.rating.readerId !== run.readerId || run.rating.target.bookId !== run.bookId) return false;
    if (!isReviewMemory(run.reviewMemoryAfter)) return false;
    if (run.reviewMemoryAfter.readerId !== run.readerId || run.reviewMemoryAfter.bookId !== run.bookId) return false;
  }
  if (!run.usage || typeof run.usage.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(run.usage.date) || !run.usage.delta) return false;
  const delta = run.usage.delta;
  for (const key of ["chapters", "words", "tokens"] as const) {
    if (typeof delta[key] !== "number" || !Number.isFinite(delta[key]) || delta[key] < 0) return false;
  }
  if (typeof delta.unknown !== "boolean") return false;
  return true;
}

export async function listJournalRuns(root: string): Promise<Array<{ file: string; run: JournalRun }>> {
  const dir = path.join(root, PENDING);
  if (!existsSync(dir)) return [];
  const names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  const out: Array<{ file: string; run: JournalRun }> = [];
  for (const name of names) {
    const file = path.join(dir, name);
    // 读取失败（权限/占用等 I/O 异常）≠ 日志损坏：必须保留并抛错，不能隔离后放行新写入
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      throw new Error(`读取提交日志失败：${file}（日志保留在 pending）：${error instanceof Error ? error.message : String(error)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await quarantineJournalFile(root, name);
      continue;
    }
    if (!isJournalRun(parsed)) {
      await quarantineJournalFile(root, name);
      continue;
    }
    out.push({ file, run: parsed });
  }
  return out.sort((a, b) => a.run.seq - b.run.seq || a.run.txId.localeCompare(b.run.txId));
}

export async function removeJournalRun(root: string, txId: string, seq: number): Promise<void> {
  await unlink(path.join(root, PENDING, `${String(seq).padStart(16, "0")}-${txId}.json`)).catch(() => undefined);
}

export async function quarantineJournalFile(root: string, name: string): Promise<void> {
  const dir = path.join(root, FAILED);
  await mkdir(dir, { recursive: true });
  await rename(path.join(root, PENDING, name), path.join(dir, `${Date.now()}-${name}`)).catch(() => undefined);
}
