import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import type {
  BookRecord,
  ChapterRating,
  ChapterRecord,
  ComparisonAttribution,
  QuotaLimits,
  QuotaUsage,
  RatingComparisonInput,
  ReadingMemory,
  ReaderAgent,
  ReaderLimits,
  ReaderStatus,
  ReviewMemory,
  StarRating,
  TasteProfile,
  TasteTagWeight,
} from "../core/index.ts";
import { DEFAULT_GLOBAL_QUOTA, DEFAULT_READER_QUOTA, DEFAULT_READER_LIMITS } from "../core/index.ts";
import {
  addUsage,
  advanceReviewMemory,
  assertCanCreateReader,
  assertNextReadingChapter,
  assertReviewOrder,
  assertSafeId,
  buildRating,
  canonicalTag,
  checkQuota,
  compareRatings,
  distillCommentEvidence,
  commentStyleHints,
  createInitialTaste,
  draftToRating,
  emptyReadingMemory,
  emptyUsage,
  generateReview,
  mergeReviewMemory,
  nextFatigue,
  normalizeTags,
  planNewBookSlots,
  rankCandidates,
  ratingTargetFor,
  READER_PERSONA_TEMPLATES,
  ReaderLimitError,
  renderDailyReport,
  resolveReaderLimits,
  sha256Hex,
  shortHash,
  slugify,
  tagCatalog,
  updateTaste,
} from "../reader/index.ts";
import type {
  CommentEvidence,
  ComparisonResult,
  DailyReportEntry,
  DiscoveredBook,
  InitialTasteInput,
  RatingDraft,
  ReviewModelPort,
  ScheduleDecision,
  SearchResult,
  SourceAdapter,
  TastePatch,
} from "../reader/index.ts";
import {
  atomicWrite,
  ensureLayout,
  listJsonFiles,
  readJsonOptional,
  readJsonStrict,
  readerRoot,
  writeJson,
} from "./storage.ts";
import { readPublicPage } from "./page-reader.ts";
import { listJournalRuns, removeJournalRun, writeJournalRun, type JournalRun } from "./journal.ts";

export interface ReaderServiceOptions {
  limits?: Partial<ReaderLimits>;
  globalQuota?: Partial<QuotaLimits>;
  readerQuota?: Partial<QuotaLimits>;
  clock?: () => Date;
  tzOffsetMinutes?: number;
  /** L1/L2 书源；不配就没有找书能力（导入仍可用） */
  source?: SourceAdapter;
  /** L2 公开网页导入允许的站点 host（精确匹配） */
  allowedPageHosts?: string[];
  /** 允许访问本机/私网（**只给测试用**，产品默认关闭） */
  allowPrivateHosts?: boolean;
  /** 真实评审模型端口；不配就只能用模拟读者 */
  reviewPort?: ReviewModelPort;
  /** 跨工作区共享的读者/口味根目录；不传则与工作区数据同根（单工作区/测试用） */
  globalRoot?: string;
}

export interface CreateReaderInput {
  name: string;
  persona: string;
  personaTemplateId?: string;
  taste?: Omit<InitialTasteInput, "readerId" | "now">;
}

export interface ImportBookInput {
  bookId: string;
  title: string;
  author?: string;
  sourceId?: string;
  sourceSite?: string;
  tags?: string[];
  accessLevel?: BookRecord["accessLevel"];
}

export interface ImportChapterInput {
  bookId: string;
  chapterId: string;
  sequenceNumber: number;
  title: string;
  content: string;
}

export interface ImportChapterResult {
  changed: boolean;
  revision: number;
  contentHash: string;
  wordCount: number;
}

export interface QuotaSnapshot {
  date: string;
  global: QuotaUsage;
  readers: Record<string, QuotaUsage>;
  limits: { global: QuotaLimits; reader: QuotaLimits };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ReaderService {
  readonly workspaceRoot: string;
  readonly root: string;
  readonly limits: ReaderLimits;
  readonly globalQuota: QuotaLimits;
  readonly readerQuota: QuotaLimits;
  private readonly clock: () => Date;
  private readonly tzOffsetMinutes: number;
  private readonly source: SourceAdapter | null;
  private readonly allowedPageHosts: string[];
  private readonly allowPrivateHosts: boolean;
  private readonly reviewPort: ReviewModelPort | null;
  private readonly globalRoot: string;
  private lastSeq = 0;

  constructor(workspaceRoot: string, options: ReaderServiceOptions = {}) {
    this.workspaceRoot = workspaceRoot;
    this.root = readerRoot(workspaceRoot);
    const requestedMax = options.limits?.maxReaders ?? DEFAULT_READER_LIMITS.maxReaders;
    const hardMax = options.limits?.hardMaxReaders ?? DEFAULT_READER_LIMITS.hardMaxReaders;
    this.limits = resolveReaderLimits(requestedMax, { maxReaders: requestedMax, hardMaxReaders: hardMax });
    this.globalQuota = { ...DEFAULT_GLOBAL_QUOTA, ...options.globalQuota };
    this.readerQuota = { ...DEFAULT_READER_QUOTA, ...options.readerQuota };
    this.clock = options.clock ?? (() => new Date());
    this.tzOffsetMinutes = options.tzOffsetMinutes ?? 480;
    this.source = options.source ?? null;
    this.allowedPageHosts = options.allowedPageHosts ?? [];
    this.allowPrivateHosts = options.allowPrivateHosts ?? false;
    this.reviewPort = options.reviewPort ?? null;
    this.globalRoot = options.globalRoot ? path.resolve(options.globalRoot) : this.root;
  }

  async init(): Promise<this> {
    await ensureLayout(this.workspaceRoot);
    await mkdir(path.join(this.globalRoot, "readers"), { recursive: true });
    await this.recoverJournal();
    return this;
  }

  /** 崩溃恢复：按 seq 顺序重放未完成的提交日志（记忆只前进、配额按 txId 去重） */
  async recoverJournal(): Promise<number> {
    const runs = await listJournalRuns(this.root);
    let recovered = 0;
    for (const { run } of runs) {
      try {
        await this.withWriteLock(() => this.applyJournalRun(run));
        recovered++;
      } catch (error) {
        // 应用失败（IO/数据缺失）不隔离、不丢弃：日志保留，明确报错，等人工处理
        throw new Error(
          `提交日志恢复失败：${run.txId}（日志保留在 journal/pending）：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return recovered;
  }

  /** 已持有写锁时使用：不再申请同一把锁，直接应用日志 */
  private async recoverJournalLocked(): Promise<number> {
    const runs = await listJournalRuns(this.root);
    let recovered = 0;
    for (const { run } of runs) {
      try {
        await this.applyJournalRun(run);
        recovered++;
      } catch (error) {
        throw new Error(
          `提交日志恢复失败：${run.txId}（日志保留在 journal/pending）：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return recovered;
  }

  /** 还有待恢复日志时，不允许开始新的阅读写入 */
  private async ensureJournalClean(): Promise<void> {
    const pending = await listJournalRuns(this.root);
    if (pending.length === 0) return;
    await this.recoverJournalLocked();
    const left = await listJournalRuns(this.root);
    if (left.length > 0) throw new Error("还有未恢复的提交日志（journal/pending），先处理再继续");
  }

  /** 应用一条 journal：记忆（只前进）→ 配额（带 txId 去重）→ 回执 → 删除日志 */
  private async applyJournalRun(run: JournalRun): Promise<{ memory: ReadingMemory; usage: QuotaSnapshot }> {
    const reader = await this.getReader(run.readerId);
    if (!reader) throw new Error(`日志引用的读者不存在：${run.readerId}`);
    const memoryFile = this.readingMemoryFile(run.readerId, run.bookId);
    const current = await readJsonStrict<ReadingMemory>(memoryFile);
    const shouldWrite =
      !current ||
      run.memory.readThrough > current.readThrough ||
      (run.memory.readThrough === current.readThrough && run.memory.updatedAt >= current.updatedAt);
    if (shouldWrite) await writeJson(memoryFile, run.memory);
    if (run.reviewMemoryAfter) {
      const currentReview = await this.getReviewMemory(run.readerId, run.bookId);
      if (!currentReview || run.reviewMemoryAfter.validThrough > currentReview.validThrough) {
        await writeJson(this.reviewMemoryFile(run.readerId, run.bookId), run.reviewMemoryAfter);
      }
    }
    if (run.rating) {
      await writeJson(this.safePath("readers", run.readerId, "ratings", `${run.rating.id}.json`), run.rating);
    }
    const usage = await this.addUsageLocked(
      run.readerId,
      { chapters: run.usage.delta.chapters, words: run.usage.delta.words, tokens: run.usage.delta.tokens },
      run.txId,
      run.usage.date,
    );
    if (run.usage.delta.unknown) {
      await this.addUsageLocked(run.readerId, { tokens: null }, `${run.txId}-unknown`, run.usage.date);
    }
    if (run.requestId) {
      const requestId = this.assertSafeRequestId(run.requestId);
      await writeJson(this.safePath("receipts", `${requestId}.json`), {
        requestId,
        at: run.at,
        result: { memory: run.memory, usage, ...(run.rating ? { rating: run.rating, reviewMemory: run.reviewMemoryAfter } : {}) },
      });
    }
    await removeJournalRun(this.root, run.txId, run.seq);
    return { memory: run.memory, usage };
  }

  /* --------------------------- 路径与锁（安全边界） --------------------------- */

  /** 所有落盘路径都必须落在数据根内；越界直接抛错 */
  private safePath(...parts: string[]): string {
    const root = path.resolve(this.root);
    const target = path.resolve(root, ...parts);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`路径越界：${parts.join("/")}`);
    }
    return target;
  }

  /** 读者/口味跨工作区共享：只把身份档案放在 globalRoot，评分与记忆仍随书留在工作区 */
  private globalPath(...parts: string[]): string {
    const root = path.resolve(this.globalRoot);
    const target = path.resolve(root, ...parts);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`路径越界：${parts.join("/")}`);
    }
    return target;
  }

  private assertDate(date: string): string {
    if (!DATE_RE.test(date)) throw new Error(`非法日期：${date}（要求 YYYY-MM-DD）`);
    return date;
  }

  /**
   * 短事务锁：同一工作区同一时刻只允许一个写者。
   * 失败等 3 秒；陈旧锁（>10s）可回收。锁只保护短事务，不覆盖模型调用。
   */
  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockDir = this.safePath("locks");
    await mkdir(lockDir, { recursive: true });
    const lockFile = this.safePath("locks", "write.lock");
    const token = `${process.pid}-${randomUUID()}`;
    const started = Date.now();
    for (;;) {
      try {
        const handle = await open(lockFile, "wx");
        await handle.writeFile(token);
        await handle.close();
        break;
      } catch {
        if (Date.now() - started > 3000) {
          // 不自动删除他人锁（可能误删新持有者）；留给人确认后清理
          throw new Error("写入被占用：locks/write.lock 超过 3 秒未释放。若确认没有其他写者，可手动删除该文件后重试");
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    try {
      return await fn();
    } finally {
      // 只释放自己持有的锁，避免误删别人新建的锁
      const content = await readFile(lockFile, "utf8").catch(() => null);
      if (content === token) await unlink(lockFile).catch(() => undefined);
    }
  }

  /** requestId / txId 只允许安全 basename，防止回执路径穿越 */
  private assertSafeRequestId(id: string): string {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error(`非法 requestId：${id}`);
    return id;
  }

  /** 单调提交序号（同毫秒内也严格递增） */
  private nextSeq(): number {
    const next = Math.max(Date.now(), this.lastSeq + 1);
    this.lastSeq = next;
    return next;
  }

  /* ------------------------------- 读者 ------------------------------- */

  private readerDir(readerId: string): string {
    assertSafeId(readerId, "readerId");
    return this.globalPath("readers", readerId);
  }

  private readerFile(readerId: string): string {
    return this.globalPath("readers", readerId, "reader.json");
  }

  /** 标签目录：面板/工具用同一份真源（tags.ts） */
  listTagCatalog(): ReturnType<typeof tagCatalog> {
    return tagCatalog();
  }

  /**
   * 按标签找书（不依赖某个读者的口味）：喜好标签做匹配、避雷标签硬过滤；
   * 未知标签不静默丢弃，随 unknownTags 回传，由界面提示「暂未收录」。
   */
  async searchByTags(input: {
    readerId?: string;
    tags?: string[];
    excludeTags?: string[];
    limit?: number;
  }): Promise<{ picks: DiscoveredBook[]; searchedTags: string[]; unknownTags: string[]; excludedBookIds: string[] }> {
    if (!this.source) throw new Error("没有配置书源（L1/L2），不能自己找书");
    const normalize = (tags: string[] | undefined): { tags: string[]; unknown: string[] } => {
      const out: string[] = [];
      const unknown: string[] = [];
      for (const raw of tags ?? []) {
        const value = String(raw ?? "").trim();
        if (!value) continue;
        const known = canonicalTag(value);
        if (known) out.push(known);
        else {
          out.push(value);
          unknown.push(value);
        }
      }
      return { tags: [...new Set(out)], unknown: [...new Set(unknown)] };
    };
    const liked = normalize(input.tags);
    const disliked = normalize(input.excludeTags);
    if (!liked.tags.length && !disliked.tags.length) throw new Error("至少选一个标签再找书");

    const results = await this.searchSource({ tags: liked.tags, limit: 30 });
    const dislikedSet = new Set(disliked.tags);
    const candidates = results
      .map((result) => ({ ...result.book, sourceId: result.sourceId, sourceSite: result.sourceSite }))
      .filter((book) => !book.tags.some((tag) => dislikedSet.has(tag)));
    const excluded = await this.exclusionSet(input.readerId);
    const picks = rankCandidates(
      {
        likedTags: liked.tags.map((tagId) => ({ tagId, weight: 1 })),
        dislikedTags: disliked.tags.map((tagId) => ({ tagId, weight: 1 })),
        likedAuthors: [],
        dislikedAuthors: [],
      },
      candidates,
      { excludeBookIds: [...excluded], limit: Math.min(Math.max(input.limit ?? 5, 1), 10) },
    );
    return {
      picks,
      searchedTags: liked.tags,
      unknownTags: [...new Set([...liked.unknown, ...disliked.unknown])],
      excludedBookIds: [...excluded].sort(),
    };
  }

  /** 已读/已弃排除集合：给读者时按该读者，不给时按书架上全部书 + 任一读者的弃书 */
  private async exclusionSet(readerId?: string): Promise<Set<string>> {
    const excluded = new Set<string>();
    for (const rating of await this.listRatings(readerId ? { readerId } : {})) {
      if (rating.status === "drop") excluded.add(rating.target.bookId);
    }
    for (const book of await this.listBooks()) {
      if (!readerId) {
        excluded.add(book.bookId);
        continue;
      }
      const memory = await this.getReadingMemory(readerId, book.bookId);
      if (memory && memory.readThrough > 0) excluded.add(book.bookId);
    }
    return excluded;
  }

  private normalizeTasteWeights(tags: TasteTagWeight[] | undefined): TasteTagWeight[] | undefined {
    if (!tags) return undefined;
    const seen = new Map<string, number>();
    for (const item of tags) {
      const raw = String(item?.tagId ?? "").trim();
      if (!raw) continue;
      const tagId = canonicalTag(raw) ?? raw;
      seen.set(tagId, Math.max(seen.get(tagId) ?? 0, Number(item.weight) || 0));
    }
    return [...seen.entries()].map(([tagId, weight]) => ({ tagId, weight }));
  }

  async createReader(input: CreateReaderInput): Promise<ReaderAgent> {
    const name = input.name?.trim();
    if (!name) throw new Error("读者名字不能为空");
    const persona = input.persona?.trim();
    if (!persona) throw new Error("读者人设不能为空");

    const base = slugify(name);
    let id = base;
    let n = 1;
    const used = new Set((await this.listReaders(true)).map((r) => r.id));
    while (used.has(id)) id = `${base}-${++n}`;
    assertSafeId(id, "readerId");

    return this.withWriteLock(async () => {
      const live = (await this.listReaders(true)).filter((r) => r.status !== "deleted");
      assertCanCreateReader(live.length, this.limits);
      const now = this.clock().toISOString();
      const taste = createInitialTaste({
        readerId: id,
        now,
        ...(input.taste
          ? {
              ...input.taste,
              likedTags: this.normalizeTasteWeights(input.taste.likedTags),
              dislikedTags: this.normalizeTasteWeights(input.taste.dislikedTags),
            }
          : {}),
      });
      await this.writeTaste(taste);
      const reader: ReaderAgent = {
        schemaVersion: 2,
        id,
        name,
        status: "active",
        personaTemplateId: input.personaTemplateId,
        persona,
        revision: 1,
        tasteVersion: taste.version,
        createdAt: now,
      };
      await writeJson(this.readerFile(id), reader);
      return reader;
    });
  }

  /** 用预置人设模板建一个读者（模板只复制到实例，不共享任何进度/记忆） */
  async createReaderFromTemplate(templateId: string, name?: string): Promise<ReaderAgent> {
    const template = READER_PERSONA_TEMPLATES.find((t) => t.id === templateId);
    if (!template) throw new Error(`未知读者模板：${templateId}`);
    return this.createReader({
      name: name ?? template.name,
      persona: template.persona,
      personaTemplateId: template.id,
      taste: {
        likedTags: template.likedTags,
        dislikedTags: template.dislikedTags,
        pacingTolerance: template.pacingTolerance,
        commentStyle: template.commentStyle,
        sensitivities: template.sensitivities,
      },
    });
  }

  async listReaders(includeDeleted = false): Promise<ReaderAgent[]> {
    const dir = this.globalPath("readers");
    if (!existsSync(dir)) return [];
    const names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    const out: ReaderAgent[] = [];
    for (const name of names.sort()) {
      const reader = await readJsonOptional<ReaderAgent>(this.globalPath("readers", name, "reader.json"));
      if (!reader) continue;
      if (!includeDeleted && reader.status === "deleted") continue;
      out.push(reader);
    }
    return out;
  }

  async getReader(readerId: string): Promise<ReaderAgent | null> {
    return readJsonStrict<ReaderAgent>(this.readerFile(readerId));
  }

  private async requireReader(readerId: string): Promise<ReaderAgent> {
    const reader = await this.getReader(readerId);
    if (!reader || reader.status === "deleted") throw new Error(`读者不存在：${readerId}`);
    return reader;
  }

  async setReaderStatus(readerId: string, status: ReaderStatus): Promise<ReaderAgent> {
    if (status !== "active" && status !== "paused" && status !== "deleted") {
      throw new Error(`非法读者状态：${String(status)}`);
    }
    return this.withWriteLock(async () => {
      const reader = await this.requireReader(readerId);
      const next: ReaderAgent = { ...reader, status, revision: reader.revision + 1 };
      await writeJson(this.readerFile(readerId), next);
      return next;
    });
  }

  /* ------------------------------- 口味 ------------------------------- */

  private tasteFile(readerId: string, version: string): string {
    assertSafeId(readerId, "readerId");
    if (!/^[a-f0-9]{6,64}$/.test(version)) throw new Error(`非法口味版本号：${version}`);
    return this.globalPath("readers", readerId, "taste", `${version}.json`);
  }

  private async writeTaste(taste: TasteProfile): Promise<void> {
    const file = this.tasteFile(taste.readerId, taste.version);
    if (existsSync(file)) return; // 版本不可变：已有内容绝不覆盖
    await writeJson(file, taste);
  }

  async getTaste(readerId: string, version?: string): Promise<TasteProfile | null> {
    const reader = await this.getReader(readerId);
    if (!reader) return null;
    const wanted = version ?? reader.tasteVersion;
    return readJsonStrict<TasteProfile>(this.tasteFile(readerId, wanted));
  }

  /** 口味更新：新版本 + reader 指向新版本；内容不变时不动 */
  async updateTasteProfile(readerId: string, patch: TastePatch, evidenceRatingIds: string[] = []): Promise<TasteProfile> {
    return this.withWriteLock(async () => {
      const reader = await this.requireReader(readerId);
      const current = await this.getTaste(readerId, reader.tasteVersion);
      if (!current) throw new Error(`读者 ${readerId} 的当前口味版本丢失：${reader.tasteVersion}`);
      const next = updateTaste(current, patch, evidenceRatingIds, this.clock().toISOString());
      if (next.version === current.version) return current;
      await this.writeTaste(next);
      await writeJson(this.readerFile(readerId), { ...reader, tasteVersion: next.version, revision: reader.revision + 1 });
      return next;
    });
  }

  /* -------------------------------- 书 -------------------------------- */

  private bookDir(bookId: string): string {
    assertSafeId(bookId, "bookId");
    return this.safePath("books", bookId);
  }

  private bookFile(bookId: string): string {
    return this.safePath("books", bookId, "book.json");
  }

  async importBook(input: ImportBookInput): Promise<BookRecord> {
    assertSafeId(input.bookId, "bookId");
    return this.withWriteLock(async () => {
      const existing = await readJsonStrict<BookRecord>(this.bookFile(input.bookId));
      const now = this.clock().toISOString();
      const book: BookRecord = {
        schemaVersion: 2,
        bookId: input.bookId,
        title: input.title,
        author: input.author,
        sourceId: input.sourceId,
        sourceSite: input.sourceSite,
        tags: input.tags ?? [],
        accessLevel: input.accessLevel ?? "imported",
        addedAt: existing?.addedAt ?? now,
      };
      await writeJson(this.bookFile(input.bookId), book);
      return book;
    });
  }

  async getBook(bookId: string): Promise<BookRecord | null> {
    assertSafeId(bookId, "bookId");
    return readJsonStrict<BookRecord>(this.bookFile(bookId));
  }

  async listBooks(): Promise<BookRecord[]> {
    const dir = this.safePath("books");
    if (!existsSync(dir)) return [];
    const names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    const out: BookRecord[] = [];
    for (const name of names.sort()) {
      const book = await readJsonOptional<BookRecord>(this.safePath("books", name, "book.json"));
      if (book) out.push(book);
    }
    return out;
  }

  private chapterMetaFile(bookId: string, chapterId: string): string {
    assertSafeId(chapterId, "chapterId");
    return this.safePath("books", bookId, "chapters", `${chapterId}.json`);
  }

  private chapterContentFile(bookId: string, chapterId: string, revision: number): string {
    return this.safePath("books", bookId, "content", `${chapterId}.r${revision}.json`);
  }

  /**
   * 导入章节：同样标题与正文重复导入是无变化操作（不涨 revision）。
   * 正文只统一 CRLF/CR → LF；不 trim、不改标点。
   */
  async importChapter(input: ImportChapterInput): Promise<ImportChapterResult> {
    assertSafeId(input.bookId, "bookId");
    assertSafeId(input.chapterId, "chapterId");
    if (!Number.isInteger(input.sequenceNumber) || input.sequenceNumber < 1) {
      throw new Error(`章节序号必须是 >=1 的整数，收到 ${input.sequenceNumber}`);
    }
    const book = await this.getBook(input.bookId);
    if (!book) throw new Error(`书不存在：${input.bookId}`);
    return this.withWriteLock(async () => {
      const normalized = input.content.replace(/\r\n?/g, "\n");
      const contentHash = sha256Hex(normalized);
      const wordCount = [...normalized.replace(/\s+/g, "")].length;
      const existing = await readJsonStrict<ChapterRecord>(this.chapterMetaFile(input.bookId, input.chapterId));
      if (existing && existing.contentHash === contentHash && existing.title === input.title) {
        // 内容没变：只补做「上次中断、已落标记」的失效，不无故换代
        await this.consumeInvalidations(input.bookId);
        return { changed: false, revision: existing.revision, contentHash, wordCount: existing.wordCount };
      }
      const revision = (existing?.revision ?? 0) + 1;
      await writeJson(this.chapterContentFile(input.bookId, input.chapterId, revision), {
        chapterId: input.chapterId,
        revision,
        content: normalized,
        contentHash,
      });
      // 改稿：先落「失效标记」，再写元数据，最后消费标记；
      // 任一步中断，重试时都会按标记补完（正常重复导入不会误换代）
      if (existing) await this.markInvalidation(input.bookId, input.sequenceNumber, input.chapterId);
      const record: ChapterRecord = {
        schemaVersion: 2,
        chapterId: input.chapterId,
        sequenceNumber: input.sequenceNumber,
        title: input.title,
        revision,
        contentHash,
        wordCount,
        importedAt: this.clock().toISOString(),
      };
      await writeJson(this.chapterMetaFile(input.bookId, input.chapterId), record);
      await this.consumeInvalidations(input.bookId);
      return { changed: true, revision, contentHash, wordCount };
    });
  }

  /** 改稿失效标记：`books/<id>/invalidation/<seq>.json`，重试时消费 */
  private invalidationFile(bookId: string, sequenceNumber: number): string {
    return this.safePath("books", bookId, "invalidation", `${sequenceNumber}.json`);
  }

  private async markInvalidation(bookId: string, sequenceNumber: number, chapterId: string): Promise<void> {
    await writeJson(this.invalidationFile(bookId, sequenceNumber), {
      schemaVersion: 2,
      bookId,
      chapterId,
      sequenceNumber,
      at: this.clock().toISOString(),
    });
  }

  /** 消费失效标记：把 validThrough ≥ N 的评审链回退到 N−1、generation+1；全部成功才删标记 */
  private async consumeInvalidations(bookId: string): Promise<void> {
    const dir = this.safePath("books", bookId, "invalidation");
    const files = await listJsonFiles(dir);
    for (const file of files) {
      const marker = await readJsonStrict<{ sequenceNumber?: number }>(file);
      const sequenceNumber = marker?.sequenceNumber;
      if (!Number.isInteger(sequenceNumber) || (sequenceNumber as number) < 1) {
        await unlink(file).catch(() => undefined);
        continue;
      }
      for (const reader of await this.listReaders()) {
        const memory = await this.getReviewMemory(reader.id, bookId);
        if (!memory || memory.validThrough < (sequenceNumber as number)) continue;
        await writeJson(this.reviewMemoryFile(reader.id, bookId), {
          ...memory,
          validThrough: Math.max(0, (sequenceNumber as number) - 1),
          invalidFrom:
            memory.invalidFrom === null ? (sequenceNumber as number) : Math.min(memory.invalidFrom, sequenceNumber as number),
          generation: memory.generation + 1,
          updatedAt: this.clock().toISOString(),
        });
      }
      await unlink(file).catch(() => undefined);
    }
  }

  async getChapter(bookId: string, chapterId: string): Promise<ChapterRecord | null> {
    return readJsonStrict<ChapterRecord>(this.chapterMetaFile(bookId, chapterId));
  }

  async getChapterContent(bookId: string, chapterId: string, revision?: number): Promise<string | null> {
    const meta = await this.getChapter(bookId, chapterId);
    if (!meta) return null;
    if (meta.contentOrigin === "public-page") return null; // 外部正文不落盘，只留短摘录
    const rev = revision ?? meta.revision;
    const data = await readJsonStrict<{ content: string }>(this.chapterContentFile(bookId, chapterId, rev));
    return data?.content ?? null;
  }

  async listChapters(bookId: string): Promise<ChapterRecord[]> {
    assertSafeId(bookId, "bookId");
    const dir = this.safePath("books", bookId, "chapters");
    const files = await listJsonFiles(dir);
    const out: ChapterRecord[] = [];
    for (const file of files) {
      const rec = await readJsonOptional<ChapterRecord>(file);
      if (rec) out.push(rec);
    }
    return out.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }

  /**
   * L2：从用户给的公开网页导入一章（只允许配置过的站点）。
   * 版权/隐私边界：**外部正文只在本次调用内存里处理，不落盘** ——
   * 只保存元信息、内容指纹、字数与 ≤300 字短摘录；之后要重读必须重新抓取。
   */
  async importFromUrl(input: {
    url: string;
    bookId: string;
    chapterId: string;
    sequenceNumber: number;
    title?: string;
    fetchImpl?: typeof fetch;
  }): Promise<{ book: BookRecord; chapter: ChapterRecord; page: { title: string; host: string; bytes: number; excerptChars: number } }> {
    assertSafeId(input.bookId, "bookId");
    assertSafeId(input.chapterId, "chapterId");
    if (this.allowedPageHosts.length === 0) {
      throw new Error("没有配置允许的公开站点（allowedPageHosts），不能从网页导入");
    }
    if (!Number.isInteger(input.sequenceNumber) || input.sequenceNumber < 1) {
      throw new Error(`章节序号必须是 >=1 的整数，收到 ${input.sequenceNumber}`);
    }
    const page = await readPublicPage(input.url, {
      allowedHosts: this.allowedPageHosts,
      allowPrivateHosts: this.allowPrivateHosts,
      fetchImpl: input.fetchImpl,
    });
    if (page.text.trim().length === 0) {
      throw new Error("页面没有可读正文（可能是脚本渲染页），请改用粘贴/文件导入");
    }
    const excerpt = [...page.text].slice(0, 300).join("");
    const wordCount = [...page.text.replace(/\s+/g, "")].length;
    const contentHash = sha256Hex(page.text);
    const title = input.title ?? page.title ?? input.chapterId;
    const book = await this.importBook({
      bookId: input.bookId,
      title: page.title || input.bookId,
      sourceId: page.url,
      sourceSite: page.host,
      accessLevel: "public",
    });
    return this.withWriteLock(async () => {
      const existing = await readJsonStrict<ChapterRecord>(this.chapterMetaFile(input.bookId, input.chapterId));
      if (existing && existing.contentHash === contentHash && existing.title === title) {
        return {
          book,
          chapter: existing,
          page: { title: page.title, host: page.host, bytes: page.bytes, excerptChars: [...(existing.excerpt ?? "")].length },
        };
      }
      const revision = (existing?.revision ?? 0) + 1;
      await writeJson(this.chapterContentFile(input.bookId, input.chapterId, revision), {
        chapterId: input.chapterId,
        revision,
        excerptOnly: true,
        excerpt,
        contentHash,
      });
      const chapter: ChapterRecord = {
        schemaVersion: 2,
        chapterId: input.chapterId,
        sequenceNumber: input.sequenceNumber,
        title,
        revision,
        contentHash,
        wordCount,
        importedAt: this.clock().toISOString(),
        contentOrigin: "public-page",
        excerpt,
      };
      await writeJson(this.chapterMetaFile(input.bookId, input.chapterId), chapter);
      return { book, chapter, page: { title: page.title, host: page.host, bytes: page.bytes, excerptChars: [...excerpt].length } };
    });
  }

  /* -------------------------------- 找书 ------------------------------- */

  /** L1：搜索书源；标签会先过别名表，未知标签不冒充已知 */
  async searchSource(query: { text?: string; tags?: string[]; limit?: number }): Promise<SearchResult[]> {
    if (!this.source) throw new Error("没有配置书源（L1/L2），只能导入用户自带的作品");
    const results = await this.source.search(query);
    return results.map((result) => {
      const normalized = normalizeTags(result.book.tags);
      // 未知站点标签保留原文：避雷/排除要按字面比较，不能因为「库里没有」就被丢掉
      return { ...result, book: { ...result.book, tags: [...new Set([...normalized.known, ...normalized.unknown])] } };
    });
  }

  /**
   * 按读者口味找书：取权重最高的几个喜欢标签去搜 → 排除已读/已弃 → 多样性排序。
   * 找不到就返回空，不硬凑。
   */
  async discoverForReader(readerId: string, limit = 3): Promise<{ picks: DiscoveredBook[]; searchedTags: string[]; excludedBookIds: string[] }> {
    const reader = await this.requireReader(readerId);
    const taste = await this.getTaste(reader.id);
    if (!taste) throw new Error(`读者 ${readerId} 没有口味档案`);
    if (!this.source) throw new Error("没有配置书源（L1/L2），不能自己找书");

    const searchedTags = [...taste.likedTags]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4)
      .map((t) => t.tagId);
    const results = await this.searchSource({ tags: searchedTags, limit: 20 });
    const candidates = results.map((r) => ({ ...r.book, sourceId: r.sourceId, sourceSite: r.sourceSite }));

    const excluded = await this.exclusionSet(reader.id);

    const picks = rankCandidates(
      {
        likedTags: taste.likedTags,
        dislikedTags: taste.dislikedTags,
        likedAuthors: taste.likedAuthors,
        dislikedAuthors: taste.dislikedAuthors,
      },
      candidates,
      { excludeBookIds: [...excluded], limit },
    );
    return { picks, searchedTags, excludedBookIds: [...excluded].sort() };
  }

  /** 更新读者口味标签（喜好/雷点），生成新口味版本；内容不变就不动 */
  async updateReaderTags(readerId: string, likedTags: string[], dislikedTags: string[]): Promise<TasteProfile> {
    const patch = {
      likedTags: this.normalizeTasteWeights(likedTags.map((tagId) => ({ tagId, weight: 0.5 }))),
      dislikedTags: this.normalizeTasteWeights(dislikedTags.map((tagId) => ({ tagId, weight: 0.8 }))),
    };
    return this.updateTasteProfile(readerId, patch);
  }

  /** 评论区学习：只返回分布与风格提示，不保留任何评论原文 */
  async learnFromComments(bookId: string, chapterId: string): Promise<{ evidence: CommentEvidence; hints: string[] }> {
    assertSafeId(bookId, "bookId");
    assertSafeId(chapterId, "chapterId");
    if (!this.source) throw new Error("没有配置书源（L1/L2），读不到评论区");
    const comments = await this.source.fetchComments(bookId, chapterId);
    const evidence = distillCommentEvidence(comments);
    return { evidence, hints: commentStyleHints(evidence) };
  }

  /** 今天还能开几个新书任务、轮到谁（自动模式只在谷时） */
  async planSlots(mode: "auto" | "manual"): Promise<ScheduleDecision> {
    const readers = (await this.listReaders()).filter((r) => r.status === "active");
    const quota = await this.quota();
    const ratings = await this.listRatings();
    const lastServed = new Map<string, string>();
    for (const rating of ratings) {
      const previous = lastServed.get(rating.readerId);
      if (!previous || previous < rating.createdAt) lastServed.set(rating.readerId, rating.createdAt);
    }
    return planNewBookSlots({
      now: this.clock(),
      tzOffsetMinutes: this.tzOffsetMinutes,
      mode,
      limits: quota.limits.global,
      usage: quota.global,
      readerLimit: quota.limits.reader,
      readers: readers.map((reader) => ({
        readerId: reader.id,
        usage: quota.readers[reader.id],
        lastServedAt: lastServed.get(reader.id),
      })),
    });
  }

  /* -------------------------------- 评分 ------------------------------- */

  private ratingsDir(readerId: string): string {
    assertSafeId(readerId, "readerId");
    return this.safePath("readers", readerId, "ratings");
  }

  async saveRating(draft: RatingDraft): Promise<ChapterRating> {
    return this.withWriteLock(async () => {
      const rating = await this.checkRating(draft);
      await writeJson(this.safePath("readers", rating.readerId, "ratings", `${rating.id}.json`), rating);
      return rating;
    });
  }

  /** 评分前置校验（不写盘）：字段、目标章节、指纹/版本、口味版本、评审链顺序 */
  async checkRating(draft: RatingDraft): Promise<ChapterRating> {
    const reader = await this.requireReader(draft.readerId);
    if (reader.status !== "active") throw new Error(`读者 ${reader.id} 当前不是 active，不能评分`);
    const rating = buildRating({ ...draft, now: draft.now ?? this.clock().toISOString() });
    const kind = rating.target.kind;
    if (kind !== "external" && kind !== "manuscript") {
      throw new Error(`评分目标类型非法：${String(kind)}（只允许 external / manuscript）`);
    }
    if (kind === "manuscript" && (!Number.isInteger(rating.target.chapterNumber) || rating.target.chapterNumber < 1)) {
      throw new Error("作者稿评分必须带合法的章节号 chapterNumber");
    }
    if (kind === "external" && !rating.target.sourceId) {
      throw new Error("外部作品评分必须带 sourceId");
    }
    assertSafeId(rating.target.bookId, "bookId");
    assertSafeId(rating.target.chapterId, "chapterId");
    const chapter = await this.getChapter(rating.target.bookId, rating.target.chapterId);
    if (!chapter) throw new Error(`评分的章节不存在：${rating.target.bookId}/${rating.target.chapterId}`);
    if (chapter.contentHash !== rating.target.contentHash) {
      throw new Error("评分目标的正文指纹与当前章节不一致（可能已改稿），请刷新后重评");
    }
    if (rating.target.kind === "manuscript") {
      if (rating.target.revision !== chapter.revision) {
        throw new Error(`评分目标的稿件版本 ${rating.target.revision} 与当前版本 ${chapter.revision} 不一致`);
      }
      if (rating.target.chapterNumber !== chapter.sequenceNumber) {
        throw new Error(`评分目标的章节号 ${rating.target.chapterNumber} 与章节实际序号 ${chapter.sequenceNumber} 不一致`);
      }
      // 防剧透：第 N 章必须有第 N−1 章的有效评审记忆
      if (chapter.sequenceNumber > 1) {
        const memory = await this.getReviewMemory(reader.id, rating.target.bookId);
        if (!memory) throw new Error(`还没有评审链记忆，不能直接评第 ${chapter.sequenceNumber} 章`);
        if (memory.validThrough !== chapter.sequenceNumber - 1) {
          throw new Error(
            `评审链有效读到第 ${memory.validThrough} 章，只能评第 ${memory.validThrough + 1} 章（请求第 ${chapter.sequenceNumber} 章）`,
          );
        }
      }
    }
    const taste = await this.getTaste(reader.id, rating.tasteVersion);
    if (!taste) throw new Error(`引用不存在的口味版本：${rating.tasteVersion}`);
    return rating;
  }

  async listRatings(query: { readerId?: string; bookId?: string; chapterId?: string } = {}): Promise<ChapterRating[]> {
    const readers = query.readerId ? [await this.requireReader(query.readerId)] : await this.listReaders();
    const out: ChapterRating[] = [];
    for (const reader of readers) {
      for (const file of await listJsonFiles(this.ratingsDir(reader.id))) {
        const rating = await readJsonOptional<ChapterRating>(file);
        if (!rating) continue;
        if (query.bookId && rating.target.bookId !== query.bookId) continue;
        if (query.chapterId && rating.target.chapterId !== query.chapterId) continue;
        out.push(rating);
      }
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** 同一章的多读者分歧（只读聚合，不返回任何读者记忆） */
  async compareChapter(input: { bookId: string; chapterId: string; revision: number; readerIds?: string[] }): Promise<ComparisonResult> {
    const chapter = await this.getChapter(input.bookId, input.chapterId);
    if (!chapter) throw new Error(`章节不存在：${input.bookId}/${input.chapterId}`);
    const readers = await this.listReaders();
    const wanted = input.readerIds ? readers.filter((r) => input.readerIds!.includes(r.id)) : readers;
    const items: RatingComparisonInput["items"] = [];
    for (const reader of wanted) {
      const ratings = await this.listRatings({ readerId: reader.id, bookId: input.bookId, chapterId: input.chapterId });
      // 只比较同一份正文（contentHash）且同一稿件版本的评分；不退回其他版本
      const rating = ratings.find(
        (r) =>
          r.target.contentHash === chapter.contentHash &&
          (r.target.kind !== "manuscript" || r.target.revision === input.revision),
      );
      if (!rating) continue;
      items.push({
        readerId: reader.id,
        readerName: reader.name,
        tasteVersion: rating.tasteVersion,
        revision: rating.target.kind === "manuscript" ? rating.target.revision : input.revision,
        stars: rating.stars,
        chapterComment: rating.chapterComment,
        segmentComments: rating.segmentComments,
      });
    }
    return compareRatings({ bookId: input.bookId, chapterId: input.chapterId, targetRevision: input.revision, items });
  }

  /* -------------------------------- 记忆 ------------------------------- */

  private readingMemoryFile(readerId: string, bookId: string): string {
    assertSafeId(bookId, "bookId");
    return this.safePath("readers", readerId, "memory", "reading", `${bookId}.json`);
  }

  private reviewMemoryFile(readerId: string, bookId: string): string {
    assertSafeId(bookId, "bookId");
    return this.safePath("readers", readerId, "memory", "review", `${bookId}.json`);
  }

  async getReadingMemory(readerId: string, bookId: string): Promise<ReadingMemory | null> {
    return readJsonStrict<ReadingMemory>(this.readingMemoryFile(readerId, bookId));
  }

  async saveReadingMemory(memory: ReadingMemory): Promise<void> {
    assertSafeId(memory.readerId, "readerId");
    const current = await this.getReader(memory.readerId);
    if (!current) throw new Error(`读者不存在：${memory.readerId}`);
    await writeJson(this.readingMemoryFile(memory.readerId, memory.bookId), memory);
  }

  async getReviewMemory(readerId: string, bookId: string): Promise<ReviewMemory | null> {
    return readJsonStrict<ReviewMemory>(this.reviewMemoryFile(readerId, bookId));
  }

  async saveReviewMemory(memory: ReviewMemory): Promise<void> {
    assertSafeId(memory.readerId, "readerId");
    const current = await this.getReader(memory.readerId);
    if (!current) throw new Error(`读者不存在：${memory.readerId}`);
    await writeJson(this.reviewMemoryFile(memory.readerId, memory.bookId), memory);
  }

  /**
   * 按序读一章：校验顺序 → 校验配额 → 更新该读者的阅读记忆 → 记账。
   * v0.2 阶段记忆内容由调用方给出（模拟或真实引擎产出）；这里只负责一致性与边界。
   */
  async readChapter(input: {
    readerId: string;
    bookId: string;
    chapterId: string;
    stars?: StarRating;
    tokens?: number | null;
    memoryPatch?: Partial<Pick<ReadingMemory, "characters" | "expectations" | "emotionalTone" | "unreadQuestions" | "droppedReason">>;
    requestId?: string;
  }): Promise<{ memory: ReadingMemory; usage: QuotaSnapshot }> {
    const reader = await this.requireReader(input.readerId);
    if (reader.status !== "active") throw new Error(`读者 ${reader.id} 当前不是 active，不能阅读`);
    const chapter = await this.getChapter(input.bookId, input.chapterId);
    if (!chapter) throw new Error(`章节不存在：${input.bookId}/${input.chapterId}`);

    return this.withWriteLock(async () => {
      await this.ensureJournalClean();
      // 幂等：同一 requestId 直接返回上次结果
      if (input.requestId) {
        const requestId = this.assertSafeRequestId(input.requestId);
        const receipt = await readJsonStrict<{ result: { memory: ReadingMemory; usage: QuotaSnapshot } }>(
          this.safePath("receipts", `${requestId}.json`),
        );
        if (receipt) return receipt.result;
      }

      const previous = (await this.getReadingMemory(reader.id, input.bookId)) ?? emptyReadingMemory(reader.id, input.bookId);
      assertNextReadingChapter(previous.readThrough, chapter.sequenceNumber);

      const estimateTokens = Math.ceil(chapter.wordCount * 2);
      const tokens = input.tokens === undefined ? estimateTokens : input.tokens;
      if (tokens !== null && (!Number.isFinite(tokens) || tokens < 0)) {
        throw new Error(`token 用量必须是非负有限数，收到 ${String(tokens)}`);
      }
      const ledgerTokens = tokens ?? estimateTokens;
      const unknown = input.tokens === null;

      const quota = await this.quota();
      const delta = { chapters: 1, words: chapter.wordCount, tokens: ledgerTokens };
      const check = checkQuota(quota.limits.global, quota.global, delta);
      const readerCheck = checkQuota(quota.limits.reader, quota.readers[reader.id] ?? emptyUsage(), delta);
      const exceeded = check.ok ? readerCheck : check;
      if (!exceeded.ok) {
        throw new ReaderLimitError("LIMIT_EXCEEDED", exceeded.message ?? "今日配额已用完", { exceeded: exceeded.exceeded });
      }

      const now = this.clock().toISOString();
      // 只接受白名单字段，身份由入参绑定，不允许补丁覆盖 readerId/bookId
      const patch = input.memoryPatch ?? {};
      const memory: ReadingMemory = {
        ...previous,
        characters: patch.characters ?? previous.characters,
        expectations: patch.expectations ?? previous.expectations,
        emotionalTone: patch.emotionalTone ?? previous.emotionalTone,
        unreadQuestions: patch.unreadQuestions ?? previous.unreadQuestions,
        droppedReason: patch.droppedReason ?? previous.droppedReason,
        readThrough: chapter.sequenceNumber,
        fatigueCounter: input.stars ? nextFatigue(previous.fatigueCounter, input.stars) : previous.fatigueCounter,
        updatedAt: now,
      };
      // 先落提交日志，再应用：崩溃后 init() 会重放（记忆覆盖幂等、配额按 txId 去重）
      const run: JournalRun = {
        schemaVersion: 2,
        seq: this.nextSeq(),
        txId: randomUUID(),
        kind: "read-chapter",
        at: now,
        readerId: reader.id,
        bookId: input.bookId,
        memory,
        usage: { date: this.localDate(), delta: { chapters: 1, words: chapter.wordCount, tokens: ledgerTokens, unknown } },
        requestId: input.requestId,
      };
      await writeJournalRun(this.root, run);
      return this.applyJournalRun(run);
    });
  }

  /**
   * 真实评审：模型读第 N 章 → 严格校验 → 一次修复 → 评分 + 阅读记忆 + 评审链记忆 + 配额一次提交。
   * 只评审作者稿（manuscript）；外部公开页只有短摘录，不能作为完整正文评审。
   */
  async reviewChapter(input: {
    readerId: string;
    bookId: string;
    chapterId: string;
    port?: ReviewModelPort;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<{
    rating: ChapterRating;
    memory: ReadingMemory;
    reviewMemory: ReviewMemory;
    usage: QuotaSnapshot;
    repaired: boolean;
  }> {
    const port = input.port ?? this.reviewPort;
    if (!port) throw new Error("没有配置评审模型端口（reviewPort），只能使用模拟读者");
    const reader = await this.requireReader(input.readerId);
    if (reader.status !== "active") throw new Error(`读者 ${reader.id} 当前不是 active，不能评审`);
    const chapter = await this.getChapter(input.bookId, input.chapterId);
    if (!chapter) throw new Error(`章节不存在：${input.bookId}/${input.chapterId}`);
    if (chapter.contentOrigin === "public-page") {
      throw new Error("公开页只保存了短摘录，不能做完整评审；请用导入的稿件");
    }
    const taste = await this.getTaste(reader.id);
    if (!taste) throw new Error(`读者 ${reader.id} 没有口味档案`);
    const content = await this.getChapterContent(input.bookId, input.chapterId, chapter.revision);
    if (!content) throw new Error(`章节正文缺失：${input.bookId}/${input.chapterId} r${chapter.revision}`);

    const reviewMemory = await this.getReviewMemory(reader.id, input.bookId);
    assertReviewOrder(reviewMemory, chapter.sequenceNumber, reviewMemory?.generation ?? 1);

    if (input.requestId) {
      const requestId = this.assertSafeRequestId(input.requestId);
      const receipt = await readJsonStrict<{
        result: { rating?: ChapterRating; memory?: ReadingMemory; usage?: QuotaSnapshot; reviewMemory?: ReviewMemory };
      }>(this.safePath("receipts", `${requestId}.json`));
      if (receipt?.result?.rating && receipt.result.memory && receipt.result.usage && receipt.result.reviewMemory) {
        return {
          rating: receipt.result.rating,
          memory: receipt.result.memory,
          reviewMemory: receipt.result.reviewMemory,
          usage: receipt.result.usage,
          repaired: false,
        };
      }
    }

    const estimateTokens = Math.ceil(chapter.wordCount * 2);
    const quota = await this.quota();
    const precheckDelta = { chapters: 1, words: chapter.wordCount, tokens: estimateTokens };
    const globalCheck = checkQuota(quota.limits.global, quota.global, precheckDelta);
    const readerCheck = checkQuota(quota.limits.reader, quota.readers[reader.id] ?? emptyUsage(), precheckDelta);
    const exceeded = globalCheck.ok ? readerCheck : globalCheck;
    if (!exceeded.ok) {
      throw new ReaderLimitError("LIMIT_EXCEEDED", exceeded.message ?? "今日配额已用完", { exceeded: exceeded.exceeded });
    }

    const generated = await generateReview(
      port,
      {
        reader,
        taste,
        reviewMemory,
        bookId: input.bookId,
        chapterId: input.chapterId,
        chapterNumber: chapter.sequenceNumber,
        title: chapter.title,
        content,
      },
      { signal: input.signal },
    );

    const providerUsage = generated.response.usage;
    const tokensKnown = providerUsage.inputTokens !== null && providerUsage.outputTokens !== null;
    const totalTokens = tokensKnown ? (providerUsage.inputTokens as number) + (providerUsage.outputTokens as number) : estimateTokens;
    const now = this.clock().toISOString();
    const target = ratingTargetFor({
      bookId: input.bookId,
      chapterId: input.chapterId,
      contentHash: chapter.contentHash,
      sequenceNumber: chapter.sequenceNumber,
      revision: chapter.revision,
    });
    const draftRating = buildRating(
      draftToRating(
        generated.draft,
        {
          readerId: reader.id,
          target,
          tasteVersion: taste.version,
          providerId: port.id,
          model: generated.response.model || port.model,
        },
        providerUsage,
      ),
    );
    const memory = mergeReviewMemory(await this.getReadingMemory(reader.id, input.bookId) ?? emptyReadingMemory(reader.id, input.bookId), generated.draft, {
      bookId: input.bookId,
      sequenceNumber: chapter.sequenceNumber,
    }, now);
    const nextReviewMemory = advanceReviewMemory(
      reviewMemory,
      generated.draft,
      { bookId: input.bookId, readerId: reader.id, chapterNumber: chapter.sequenceNumber },
      now,
    );

    return this.withWriteLock(async () => {
      await this.ensureJournalClean();
      if (input.requestId) {
        const requestId = this.assertSafeRequestId(input.requestId);
        const receipt = await readJsonStrict<{
          result: { rating?: ChapterRating; memory?: ReadingMemory; usage?: QuotaSnapshot; reviewMemory?: ReviewMemory };
        }>(this.safePath("receipts", `${requestId}.json`));
        if (receipt?.result?.rating && receipt.result.memory && receipt.result.usage && receipt.result.reviewMemory) {
          return {
            rating: receipt.result.rating,
            memory: receipt.result.memory,
            reviewMemory: receipt.result.reviewMemory,
            usage: receipt.result.usage,
            repaired: false,
          };
        }
      }
      // 锁内再核一次顺序与配额（模型调用期间可能有别的读者推进）
      const latestReview = await this.getReviewMemory(reader.id, input.bookId);
      assertReviewOrder(latestReview, chapter.sequenceNumber, latestReview?.generation ?? 1);
      const latestQuota = await this.quota();
      const latestGlobal = checkQuota(latestQuota.limits.global, latestQuota.global, { chapters: 1, words: chapter.wordCount, tokens: totalTokens });
      const latestReader = checkQuota(latestQuota.limits.reader, latestQuota.readers[reader.id] ?? emptyUsage(), { chapters: 1, words: chapter.wordCount, tokens: totalTokens });
      const latestExceeded = latestGlobal.ok ? latestReader : latestGlobal;
      if (!latestExceeded.ok) {
        throw new ReaderLimitError("LIMIT_EXCEEDED", latestExceeded.message ?? "今日配额已用完", { exceeded: latestExceeded.exceeded });
      }

      const run: JournalRun = {
        schemaVersion: 2,
        seq: this.nextSeq(),
        txId: randomUUID(),
        kind: "review-chapter",
        at: now,
        readerId: reader.id,
        bookId: input.bookId,
        memory,
        rating: draftRating,
        reviewMemoryAfter: nextReviewMemory,
        usage: {
          date: this.localDate(new Date(now)),
          delta: { chapters: 1, words: chapter.wordCount, tokens: totalTokens, unknown: !tokensKnown },
        },
        requestId: input.requestId,
      };
      await writeJournalRun(this.root, run);
      const applied = await this.applyJournalRun(run);
      return {
        rating: draftRating,
        memory: applied.memory,
        reviewMemory: nextReviewMemory,
        usage: applied.usage,
        repaired: generated.repaired,
      };
    });
  }

  /** 由当日评分汇总生成日报（不写文件），格式见 reader 的 renderDailyReport */
  async buildDailyReport(date = this.localDate()): Promise<string> {
    this.assertDate(date);
    const ratings = await this.listRatings();
    const byBook = new Map<string, ChapterRating>();
    for (const rating of ratings) {
      if (this.localDateOf(rating.createdAt) !== date) continue;
      const key = `${rating.target.bookId}`;
      const current = byBook.get(key);
      if (!current || current.createdAt < rating.createdAt) byBook.set(key, rating);
    }
    const entries: DailyReportEntry[] = [];
    for (const rating of byBook.values()) {
      const book = await this.getBook(rating.target.bookId);
      const chapter = await this.getChapter(rating.target.bookId, rating.target.chapterId);
      entries.push({
        bookId: rating.target.bookId,
        title: book?.title ?? rating.target.bookId,
        author: book?.author,
        readToChapter: chapter?.sequenceNumber ?? 1,
        stars: rating.stars,
        status: rating.status,
        note: rating.chapterComment,
        segmentComments: rating.segmentComments.length,
        dropReasonCode: rating.dropReasonCode,
      });
    }
    return renderDailyReport(date, entries);
  }

  /* -------------------------------- 配额 ------------------------------- */

  private quotaFile(date: string): string {
    this.assertDate(date);
    return this.safePath("quota", `${date}.json`);
  }

  localDate(at: Date = this.clock()): string {
    const shifted = new Date(at.getTime() + this.tzOffsetMinutes * 60_000);
    return shifted.toISOString().slice(0, 10);
  }

  /** 把任意 ISO 时间换算成本地日期（日报按本地日期归档） */
  localDateOf(iso: string): string {
    const at = new Date(iso);
    return this.localDate(Number.isNaN(at.getTime()) ? this.clock() : at);
  }

  private async readQuotaStored(date: string): Promise<{
    date?: string;
    global?: QuotaUsage;
    readers?: Record<string, QuotaUsage>;
    appliedTx?: string[];
  } | null> {
    return readJsonStrict(this.quotaFile(date));
  }

  async quota(date = this.localDate()): Promise<QuotaSnapshot> {
    const stored = await this.readQuotaStored(date);
    return {
      date,
      global: stored?.global ?? emptyUsage(),
      readers: stored?.readers ?? {},
      limits: { global: this.globalQuota, reader: this.readerQuota },
    };
  }

  async addUsage(readerId: string, delta: { newBooks?: number; chapters?: number; words?: number; tokens?: number | null }): Promise<QuotaSnapshot> {
    return this.withWriteLock(() => this.addUsageLocked(readerId, delta));
  }

  private async addUsageLocked(
    readerId: string,
    delta: { newBooks?: number; chapters?: number; words?: number; tokens?: number | null },
    txId?: string,
    date = this.localDate(),
  ): Promise<QuotaSnapshot> {
    assertSafeId(readerId, "readerId");
    for (const [key, value] of Object.entries(delta)) {
      if (key === "tokens") continue;
      if (value !== undefined && (!Number.isFinite(value) || (value as number) < 0)) {
        throw new Error(`配额增量 ${key} 必须是非负有限数，收到 ${String(value)}`);
      }
    }
    if (delta.tokens !== undefined && delta.tokens !== null && (!Number.isFinite(delta.tokens) || delta.tokens < 0)) {
      throw new Error(`配额增量 tokens 必须是非负有限数或 null，收到 ${String(delta.tokens)}`);
    }
    const stored = await this.readQuotaStored(date);
    const appliedTx = stored?.appliedTx ?? [];
    if (txId && appliedTx.includes(txId)) {
      // 已经应用过（崩溃重放）：直接返回当前账本
      return {
        date,
        global: stored?.global ?? emptyUsage(),
        readers: stored?.readers ?? {},
        limits: { global: this.globalQuota, reader: this.readerQuota },
      };
    }
    const global = addUsage(stored?.global ?? emptyUsage(), delta);
    const reader = addUsage(stored?.readers?.[readerId] ?? emptyUsage(), delta);
    const readers = { ...(stored?.readers ?? {}), [readerId]: reader };
    const nextTx = txId ? [...appliedTx, txId].slice(-2000) : appliedTx;
    await writeJson(this.quotaFile(date), { date, global, readers, appliedTx: nextTx });
    return { date, global, readers, limits: { global: this.globalQuota, reader: this.readerQuota } };
  }

  /* -------------------------------- 报告 ------------------------------- */

  async writeReport(date: string, markdown: string): Promise<string> {
    this.assertDate(date);
    const file = this.safePath("reports", `${date}.md`);
    await atomicWrite(file, markdown);
    return file;
  }

  async readReport(date: string): Promise<string | null> {
    this.assertDate(date);
    const file = this.safePath("reports", `${date}.md`);
    if (!existsSync(file)) return null;
    const { readFile } = await import("node:fs/promises");
    return readFile(file, "utf8");
  }

  /** 数据根（测试与 UI 用） */
  get dataRoot(): string {
    return this.root;
  }

  /** 读者数据摘要（不含任何正文/记忆内容） */
  async summary(readerId: string): Promise<{ reader: ReaderAgent; books: number; ratings: number; tasteVersion: string } | null> {
    const reader = await this.getReader(readerId);
    if (!reader) return null;
    const ratings = await this.listRatings({ readerId });
    const books = new Set(ratings.map((r) => r.target.bookId));
    return { reader, books: books.size, ratings: ratings.length, tasteVersion: reader.tasteVersion };
  }

  /** 内部：给迁移模块用的根 */
  get workspace(): string {
    return this.workspaceRoot;
  }

  /** 内部：内容指纹短串（测试/调试） */
  hash(text: string): string {
    return shortHash(text);
  }
}
