import type {
  CommandRequest,
  PluginAdapter,
  PluginDescriptor,
  QueryRequest,
  Result,
  ValidateRequest,
  ValidateResult,
} from "../core/index.ts";
import { existsSync } from "node:fs";
import path from "node:path";
import { fail, ok } from "../core/index.ts";
import { RatingValidationError, ReaderLimitError, ReadingOrderError, SourceStopError } from "../reader/index.ts";
import type { RatingDraft, TastePatch } from "../reader/index.ts";
import { ReaderService } from "./service.ts";
import { StorageError } from "./storage.ts";

export const READER_DESCRIPTOR: PluginDescriptor = {
  name: "reader",
  version: "0.2.0",
  dataDir: ".dsh-novel-comment",
  capabilities: ["read", "review", "rate", "taste", "quota", "report"],
};

/** 业务错误 → core 统一 Result 的错误映射 */
export function toReaderFail(error: unknown): Result<never> {
  if (error instanceof ReaderLimitError) return fail(error.code, error.message, error.details);
  if (error instanceof RatingValidationError) return fail("VALIDATION_FAILED", error.message, { field: error.field });
  if (error instanceof ReadingOrderError) {
    return fail("CONFLICT", error.message, { expectedSequence: error.expectedSequence, actualSequence: error.actualSequence });
  }
  if (error instanceof StorageError) return fail("IO_ERROR", error.message, { file: error.file });
  if (error instanceof SourceStopError) return fail("UPSTREAM_ERROR", error.message, { reason: error.reason });
  const message = error instanceof Error ? error.message : String(error);
  return fail("IO_ERROR", message);
}

/**
 * reader 的 PluginAdapter 门面：UI / DSH 壳只经过这里，不直接碰 ReaderService 或文件。
 *
 * Query   ：readers.list / reader.get / books.list / chapter.get / ratings.list / comparison.get / quota.get / report.get
 * Command ：reader.create / reader.status / book.import / chapter.import / rating.save / taste.update / report.write / quota.add
 * Validate：workspace / reader / rating
 */
export class ReaderAdapter implements PluginAdapter {
  readonly descriptor = READER_DESCRIPTOR;
  private readonly service: ReaderService;

  constructor(service: ReaderService) {
    this.service = service;
  }

  async query<T = unknown>(req: QueryRequest): Promise<Result<T>> {
    const input = (req.input ?? {}) as Record<string, unknown>;
    try {
      switch (req.query) {
        case "readers.list": {
          const readers = await this.service.listReaders();
          const summaries = await Promise.all(readers.map((r) => this.service.summary(r.id)));
          return ok({ readers: summaries.filter((s) => s !== null) } as T);
        }
        case "reader.get": {
          const reader = await this.service.getReader(String(input.readerId));
          if (!reader) return fail("NOT_FOUND", `读者不存在：${String(input.readerId)}`);
          const taste = await this.service.getTaste(reader.id);
          return ok({ reader, taste } as T);
        }
        case "books.list": {
          return ok({ books: await this.service.listBooks() } as T);
        }
        case "chapter.get": {
          const content = await this.service.getChapterContent(String(input.bookId), String(input.chapterId), input.revision as number | undefined);
          if (content === null) return fail("NOT_FOUND", "章节或版本不存在");
          const meta = await this.service.getChapter(String(input.bookId), String(input.chapterId));
          return ok({ meta, content } as T);
        }
        case "ratings.list": {
          const ratings = await this.service.listRatings({
            readerId: input.readerId as string | undefined,
            bookId: input.bookId as string | undefined,
            chapterId: input.chapterId as string | undefined,
          });
          return ok({ ratings } as T);
        }
        case "comparison.get": {
          const comparison = await this.service.compareChapter({
            bookId: String(input.bookId),
            chapterId: String(input.chapterId),
            revision: Number(input.revision),
            readerIds: input.readerIds as string[] | undefined,
          });
          return ok(comparison as T);
        }
        case "quota.get": {
          return ok((await this.service.quota(input.date as string | undefined)) as T);
        }
        case "report.get": {
          const date = String(input.date);
          const markdown = await this.service.readReport(date);
          if (markdown === null) return fail("NOT_FOUND", `没有 ${date} 的日报`);
          return ok({ date, markdown } as T);
        }
        case "report.preview": {
          const date = (input.date as string | undefined) ?? this.service.localDate();
          return ok({ date, markdown: await this.service.buildDailyReport(date) } as T);
        }
        case "source.search": {
          return ok({ results: await this.service.searchSource(input as never) } as T);
        }
        case "discover.recommend": {
          return ok((await this.service.discoverForReader(String(input.readerId), (input.limit as number | undefined) ?? 3)) as T);
        }
        case "comments.learn": {
          return ok((await this.service.learnFromComments(String(input.bookId), String(input.chapterId))) as T);
        }
        case "schedule.plan": {
          const mode = input.mode === "manual" ? "manual" : "auto";
          return ok((await this.service.planSlots(mode)) as T);
        }
        default:
          return fail("UNSUPPORTED", `未实现的查询：${req.query}`);
      }
    } catch (error) {
      return toReaderFail(error) as Result<T>;
    }
  }

  async command<T = unknown>(req: CommandRequest): Promise<Result<T>> {
    const input = (req.input ?? {}) as Record<string, unknown>;
    try {
      switch (req.command) {
        case "reader.create": {
          const reader = input.templateId
            ? await this.service.createReaderFromTemplate(String(input.templateId), input.name as string | undefined)
            : await this.service.createReader({
                name: String(input.name),
                persona: String(input.persona),
                personaTemplateId: input.personaTemplateId as string | undefined,
              });
          return ok(reader as T);
        }
        case "reader.status": {
          return ok((await this.service.setReaderStatus(String(input.readerId), input.status as never)) as T);
        }
        case "book.import": {
          return ok((await this.service.importBook(input as never)) as T);
        }
        case "book.importFromUrl": {
          return ok(
            (await this.service.importFromUrl({
              url: String(input.url),
              bookId: String(input.bookId),
              chapterId: String(input.chapterId),
              sequenceNumber: Number(input.sequenceNumber),
              title: input.title as string | undefined,
            })) as T,
          );
        }
        case "chapter.import": {
          if (req.dryRun) {
            return ok({ dryRun: true, bookId: input.bookId, chapterId: input.chapterId } as T);
          }
          return ok((await this.service.importChapter(input as never)) as T);
        }
        case "chapter.read": {
          return ok(
            (await this.service.readChapter({
              readerId: String(input.readerId),
              bookId: String(input.bookId),
              chapterId: String(input.chapterId),
              stars: input.stars as never,
              tokens: input.tokens as number | null | undefined,
              memoryPatch: input.memoryPatch as never,
              requestId: input.requestId as string | undefined,
            })) as T,
          );
        }
        case "review.start": {
          if (req.dryRun) {
            return ok({ dryRun: true, bookId: input.bookId, chapterId: input.chapterId } as T);
          }
          return ok(
            (await this.service.reviewChapter({
              readerId: String(input.readerId),
              bookId: String(input.bookId),
              chapterId: String(input.chapterId),
              requestId: input.requestId as string | undefined,
            })) as T,
          );
        }
        case "rating.save": {
          if (req.dryRun) {
            const rating = await this.service.checkRating(input as unknown as RatingDraft);
            return ok({ dryRun: true, ratingId: rating.id } as T);
          }
          return ok((await this.service.saveRating(input as unknown as RatingDraft)) as T);
        }
        case "taste.update": {
          const taste = await this.service.updateTasteProfile(
            String(input.readerId),
            (input.patch ?? {}) as TastePatch,
            (input.evidenceRatingIds ?? []) as string[],
          );
          return ok(taste as T);
        }
        case "report.write": {
          const file = await this.service.writeReport(String(input.date), String(input.markdown));
          return ok({ file } as T);
        }
        case "quota.add": {
          return ok(
            (await this.service.addUsage(String(input.readerId), {
              newBooks: input.newBooks as number | undefined,
              chapters: input.chapters as number | undefined,
              words: input.words as number | undefined,
              tokens: input.tokens as number | null | undefined,
            })) as T,
          );
        }
        default:
          return fail("UNSUPPORTED", `未实现的命令：${req.command}`);
      }
    } catch (error) {
      return toReaderFail(error) as Result<T>;
    }
  }

  async validate(req: ValidateRequest): Promise<ValidateResult> {
    const problems: Array<{ path: string; message: string }> = [];
    const name = req.validation ?? "workspace";
    try {
      if (name === "workspace") {
        // Validate 不得建目录/迁移：只读检查
        const formatFile = path.join(this.service.dataRoot, "format.json");
        if (!existsSync(formatFile)) {
          problems.push({ path: "format.json", message: "数据根尚未初始化（没有 format.json）" });
        } else {
          const readers = await this.service.listReaders(true);
          if (readers.length > this.service.limits.maxReaders) {
            problems.push({ path: "readers", message: `读者数量 ${readers.length} 超过上限 ${this.service.limits.maxReaders}` });
          }
        }
      } else if (name === "reader") {
        const readerId = String((req.input as Record<string, unknown> | undefined)?.readerId ?? "");
        if (!(await this.service.getReader(readerId))) problems.push({ path: "readerId", message: `读者不存在：${readerId}` });
      } else if (name === "rating") {
        const draft = (req.input ?? {}) as Partial<RatingDraft>;
        if (draft.stars === undefined) problems.push({ path: "stars", message: "缺少星级" });
      } else {
        problems.push({ path: "validation", message: `未知校验项：${name}` });
      }
    } catch (error) {
      problems.push({ path: "workspace", message: error instanceof Error ? error.message : String(error) });
    }
    return { ok: problems.length === 0, problems };
  }
}
