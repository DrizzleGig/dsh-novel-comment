/**
 * dsh-novel-comment — AI 读者的 DSH Host 半。
 *
 * 只注册工具，不碰别的插件目录：所有数据都在 <dir>/.dsh-novel-comment/。
 * 默认使用模拟能力；配置了 READER_LLM_BASE_URL / READER_LLM_MODEL 才真正调用模型。
 * 真实书源默认关闭：READER_SOURCE=fake 时才启用内置假书源（用于演示/测试）。
 */
import path from "node:path";
import os from "node:os";
import { access } from "node:fs/promises";
import { canonicalTag, FakeSource, OpenAICompatibleProvider, ReaderService } from "./lib/reader-core.mjs";

export const name = "novel-reader";
export const inject = ["tools"];

const output = {
  schema: { type: "object", additionalProperties: true },
  render: (_args, value) => [
    { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
  ],
};

const dirParam = {
  type: "string",
  description: "工作区根目录（绝对路径）。插件只在这个目录下的 .dsh-novel-comment/ 读写。",
};

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

async function requireDir(args, exec) {
  const raw = args?.dir ?? exec?.cwd;
  if (typeof raw !== "string" || !raw.trim()) fail("bad-dir", "dir 不能为空（传工作区绝对路径）");
  const dir = path.resolve(raw);
  try {
    await access(dir);
  } catch {
    fail("dir-not-found", `dir 不存在：${dir}`);
  }
  return dir;
}

function providerFromEnv() {
  const baseUrl = process.env.READER_LLM_BASE_URL;
  const model = process.env.READER_LLM_MODEL;
  if (!baseUrl || !model) return null;
  return new OpenAICompatibleProvider({
    baseUrl,
    model,
    apiKey: process.env.READER_LLM_API_KEY,
  });
}

async function serviceFor(dir) {
  const reviewPort = providerFromEnv() ?? undefined;
  const source = process.env.READER_SOURCE === "fake" ? new FakeSource() : undefined;
  // 读者/口味跨工作区共享；书、评分、记忆仍留在各自工作区
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  const allowedPageHosts = String(process.env.READER_PAGE_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return new ReaderService(dir, { reviewPort, source, allowedPageHosts, globalRoot: path.join(dshHome, "dsh-novel-comment") }).init();
}

function guarded(fn) {
  return async (args, deps, exec) => {
    try {
      return await fn(args ?? {}, exec);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: error?.code ?? "reader-failed", message };
    }
  };
}

const tools = [
  {
    name: "reader_books",
    description:
      "AI 读者的书与读者管理：list 看当前读者/书单/口味版本；create 用预置模板或自建人设新建读者；import 导入一本作者自己的稿件章节（正文存 reader 自己的目录，便于按序评审）。不改正文、不写其他插件目录。",
    parameters: {
      type: "object",
      properties: {
        dir: dirParam,
        action: { type: "string", enum: ["list", "create", "import"], description: "默认 list" },
        templateId: { type: "string", enum: ["binge", "emotion", "plot"], description: "create：预置人设模板" },
        name: { type: "string", description: "create：读者名字" },
        persona: { type: "string", description: "create：一句话人设（自建读者时必填）" },
        likedTags: { type: "array", items: { type: "string" }, description: "create：喜好标签（六类标签库或别名，如 系统流 / 系统文）" },
        dislikedTags: { type: "array", items: { type: "string" }, description: "create：雷点标签（找书时硬排除）" },
        bookId: { type: "string", description: "import：书 id（小写字母/数字/下划线/短横）" },
        title: { type: "string", description: "import：书名" },
        chapterId: { type: "string", description: "import：章节 id" },
        sequenceNumber: { type: "number", description: "import：章节序号，从 1 起" },
        chapterTitle: { type: "string", description: "import：章节标题" },
        content: { type: "string", description: "import：章节正文" },
      },
      required: ["dir", "action"],
      additionalProperties: false,
    },
    output,
    execute: guarded(async (args, exec) => {
      const dir = await requireDir(args, exec);
      const service = await serviceFor(dir);
      const action = args.action ?? "list";
      if (action === "list") {
        const readers = await service.listReaders();
        const books = await service.listBooks();
        const withTaste = await Promise.all(
          readers.map(async (reader) => {
            const taste = await service.getTaste(reader.id);
            return {
              id: reader.id,
              name: reader.name,
              status: reader.status,
              tasteVersion: reader.tasteVersion,
              likedTags: (taste?.likedTags ?? []).map((tag) => tag.tagId),
              dislikedTags: (taste?.dislikedTags ?? []).map((tag) => tag.tagId),
            };
          }),
        );
        return {
          readers: withTaste,
          books: books.map((b) => ({ bookId: b.bookId, title: b.title, chapters: undefined })),
          dataRoot: service.dataRoot,
        };
      }
      if (action === "create") {
        if (args.templateId) {
          const reader = await service.createReaderFromTemplate(args.templateId, args.name);
          return { reader: { id: reader.id, name: reader.name, tasteVersion: reader.tasteVersion } };
        }
        if (!args.name || !args.persona) fail("bad-args", "自建读者需要 name 与 persona");
        const weights = (values, weight) =>
          Array.isArray(values)
            ? values
                .map((value) => String(value ?? "").trim())
                .filter(Boolean)
                .map((tag) => ({ tagId: canonicalTag(tag) ?? tag, weight }))
            : undefined;
        const reader = await service.createReader({
          name: args.name,
          persona: args.persona,
          taste: { likedTags: weights(args.likedTags, 0.5), dislikedTags: weights(args.dislikedTags, 0.8) },
        });
        return { reader: { id: reader.id, name: reader.name, tasteVersion: reader.tasteVersion } };
      }
      if (action === "import") {
        for (const key of ["bookId", "title", "chapterId", "chapterTitle", "content"]) {
          if (typeof args[key] !== "string" || !args[key].trim()) fail("bad-args", `import 缺少 ${key}`);
        }
        if (!Number.isInteger(args.sequenceNumber) || args.sequenceNumber < 1) fail("bad-args", "sequenceNumber 必须是 >=1 的整数");
        const book = await service.importBook({ bookId: args.bookId, title: args.title });
        const chapter = await service.importChapter({
          bookId: args.bookId,
          chapterId: args.chapterId,
          sequenceNumber: args.sequenceNumber,
          title: args.chapterTitle,
          content: args.content,
        });
        return { book: book.bookId, chapter, revision: chapter.revision };
      }
      fail("bad-action", `未知 action：${action}`);
    }),
  },
  {
    name: "reader_review",
    description:
      "让一个 AI 读者真实评审作者稿的第 N 章：只读该读者已读到的前文记忆 + 本章正文，输出 1–5 星、章评、可选段评、追更/弃书与记忆；严格校验、失败会修复一次。第 N 章必须有第 N−1 章的有效评审记忆（防剧透）。需要先配置 READER_LLM_BASE_URL/READER_LLM_MODEL。",
    parameters: {
      type: "object",
      properties: {
        dir: dirParam,
        readerId: { type: "string", description: "读者 id" },
        bookId: { type: "string", description: "书 id" },
        chapterId: { type: "string", description: "章节 id" },
        requestId: { type: "string", description: "可选幂等 id（同一请求重试不会重复调用模型）" },
      },
      required: ["dir", "readerId", "bookId", "chapterId"],
      additionalProperties: false,
    },
    output,
    execute: guarded(async (args, exec) => {
      const dir = await requireDir(args, exec);
      const service = await serviceFor(dir);
      if (!providerFromEnv()) {
        fail(
          "model-not-configured",
          "没有配置模型端点：设置 READER_LLM_BASE_URL / READER_LLM_MODEL（可选 READER_LLM_API_KEY）后再试；未配置时只能用模拟读者。",
        );
      }
      const result = await service.reviewChapter({
        readerId: args.readerId,
        bookId: args.bookId,
        chapterId: args.chapterId,
        requestId: args.requestId,
      });
      return {
        rating: {
          stars: result.rating.stars,
          chapterComment: result.rating.chapterComment,
          status: result.rating.status,
          segmentComments: result.rating.segmentComments.length,
        },
        reviewMemory: { validThrough: result.reviewMemory.validThrough, generation: result.reviewMemory.generation },
        repaired: result.repaired,
        usage: result.usage.global,
      };
    }),
  },
  {
    name: "reader_rate",
    description:
      "手工给某一章记一条读者评分（不调模型）：1–5 整星 + 章评 + 可选段评 + 追更/观望/弃书；弃书必须给原因码。用于作者自己模拟一个读者，或补录真实读者反馈。",
    parameters: {
      type: "object",
      properties: {
        dir: dirParam,
        readerId: { type: "string" },
        bookId: { type: "string" },
        chapterId: { type: "string" },
        stars: { type: "number", description: "1–5 整数" },
        chapterComment: { type: "string", description: "章评，200 字内" },
        status: { type: "string", enum: ["follow", "watch", "drop"] },
        dropReasonCode: {
          type: "string",
          enum: ["slow_pacing", "character_break", "logic_error", "prose", "formulaic", "genre_mismatch", "other"],
        },
        segments: {
          type: "array",
          maxItems: 3,
          description: "段评：quote 必须能在正文里定位",
          items: {
            type: "object",
            properties: {
              quote: { type: "string" },
              paragraphIndex: { type: "number" },
              prefix: { type: "string" },
              suffix: { type: "string" },
              comment: { type: "string" },
            },
            required: ["quote", "paragraphIndex", "comment"],
            additionalProperties: false,
          },
        },
      },
      required: ["dir", "readerId", "bookId", "chapterId", "stars", "chapterComment", "status"],
      additionalProperties: false,
    },
    output,
    execute: guarded(async (args, exec) => {
      const dir = await requireDir(args, exec);
      const service = await serviceFor(dir);
      const reader = await service.getReader(args.readerId);
      if (!reader) fail("reader-not-found", `读者不存在：${args.readerId}`);
      const taste = await service.getTaste(reader.id);
      const chapter = await service.getChapter(args.bookId, args.chapterId);
      if (!chapter) fail("chapter-not-found", `章节不存在：${args.bookId}/${args.chapterId}`);
      const rating = await service.saveRating({
        readerId: reader.id,
        target: {
          kind: "manuscript",
          bookId: args.bookId,
          chapterId: args.chapterId,
          contentHash: chapter.contentHash,
          chapterNumber: chapter.sequenceNumber,
          revision: chapter.revision,
        },
        stars: args.stars,
        chapterComment: args.chapterComment,
        segmentComments: Array.isArray(args.segments)
          ? args.segments.slice(0, 3).map((s) => ({
              locator: {
                paragraphIndex: Number.isInteger(s.paragraphIndex) ? s.paragraphIndex : 0,
                quote: String(s.quote ?? ""),
                prefix: String(s.prefix ?? "").slice(0, 10),
                suffix: String(s.suffix ?? "").slice(0, 10),
              },
              excerpt: String(s.quote ?? ""),
              comment: String(s.comment ?? ""),
            }))
          : [],
        status: args.status,
        dropReasonCode: args.dropReasonCode,
        tasteVersion: taste.version,
        model: "manual",
        promptVersion: "manual",
        usage: { inputTokens: null, outputTokens: null, source: "unknown" },
      });
      return { ratingId: rating.id, stars: rating.stars, status: rating.status };
    }),
  },
  {
    name: "reader_report",
    description:
      "生成某天的读者日报（按本地日期）：读了哪几本、星级、一句话、跳过/弃书原因。默认同时写 .dsh-novel-comment/reports/<date>.md。",
    parameters: {
      type: "object",
      properties: {
        dir: dirParam,
        date: { type: "string", description: "YYYY-MM-DD，默认今天" },
        write: { type: "boolean", description: "是否写入 reports/，默认 true" },
      },
      required: ["dir"],
      additionalProperties: false,
    },
    output,
    execute: guarded(async (args, exec) => {
      const dir = await requireDir(args, exec);
      const service = await serviceFor(dir);
      const date = args.date ?? service.localDate();
      const markdown = await service.buildDailyReport(date);
      let file = null;
      if (args.write !== false) file = await service.writeReport(date, markdown);
      return { date, file, markdown };
    }),
  },
  {
    name: "reader_discover",
    description:
      "找书：给了 tags 就按标签搜索（喜好加权 + 雷点硬排除 + 已读过滤 + 多样性降权）；不给 tags 就按 readerId 的口味找。内置假书源只在 READER_SOURCE=fake 时可用；真实公开书源尚未接入，会明确报错而不是假装有结果。",
    parameters: {
      type: "object",
      properties: {
        dir: dirParam,
        readerId: { type: "string", description: "按口味找时必填；按标签找时会用它的已读/弃书做排除" },
        tags: { type: "array", items: { type: "string" }, description: "按标签找：喜好标签（支持别名，如 系统文 / 末日）" },
        excludeTags: { type: "array", items: { type: "string" }, description: "按标签找：避雷标签（硬排除）" },
        limit: { type: "number", description: "最多几本，按标签默认 5、按口味默认 3" },
      },
      required: ["dir"],
      additionalProperties: false,
    },
    output,
    execute: guarded(async (args, exec) => {
      const dir = await requireDir(args, exec);
      const service = await serviceFor(dir);
      if (process.env.READER_SOURCE !== "fake") {
        fail("source-not-configured", "没有接入真实书源；设置 READER_SOURCE=fake 可先用内置假书源演示。");
      }
      const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
      const excludeTags = Array.isArray(args.excludeTags) ? args.excludeTags.map(String) : [];
      if (tags.length || excludeTags.length) {
        return service.searchByTags({ readerId: args.readerId, tags, excludeTags, limit: args.limit ?? 5 });
      }
      if (!args.readerId) fail("bad-args", "按口味找书需要 readerId；或者给 tags 按标签找");
      return service.discoverForReader(args.readerId, args.limit ?? 3);
    }),
  },
];

/** Cordis Host 半：只注册工具，生命周期交给 ctx.effect 清理 */
export function apply(ctx) {
  for (const definition of tools) {
    if (typeof ctx.tools?.register !== "function") continue;
    ctx.effect(() => ctx.tools.register(definition));
  }
}
