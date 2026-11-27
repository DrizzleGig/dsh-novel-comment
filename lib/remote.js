/**
 * Host half of the AI 读者 sidebar: reads and writes go through the same
 * ReaderService the tools use, so panel and agent never disagree.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { SessionId } from "@deepseek-ai/dsh-session";
import { DESCRIPTORS } from "./remote-contract.js";
import { bindRemoteMethods, runRemoteInitializers } from "./typert-bind.js";
import { canonicalTag, FakeSource, OpenAICompatibleProvider, ReaderService } from "./reader-core.mjs";

const fail = (message) => {
  throw new Error(message);
};

function requireText(options, key) {
  const value = options?.[key];
  if (typeof value !== "string" || !value.trim()) fail(`缺少 ${key}`);
  return value.trim();
}

function providerFromEnv() {
  const baseUrl = process.env.READER_LLM_BASE_URL;
  const model = process.env.READER_LLM_MODEL;
  if (!baseUrl || !model) return null;
  return new OpenAICompatibleProvider({ baseUrl, model, apiKey: process.env.READER_LLM_API_KEY });
}

class ReaderPanelRemote extends TypertRemoteService {
  static inject = ["agents", "workingDirectory", "typert"];

  constructor(ctx) {
    super(ctx, "readerPanel");
    runRemoteInitializers(this);
    ctx.typert.register({
      package: "dsh-novel-comment",
      face: "host",
      schemas: [],
      model: { services: [], events: [], objects: [] },
      invocations: DESCRIPTORS,
    });
  }

  agent(id) {
    const agent = this.ctx.agents.get(SessionId(id));
    if (!agent) fail("会话尚未加载或已关闭，请重新打开会话后重试。");
    return agent;
  }

  async dirFor(id) {
    const agent = this.agent(id);
    const dir = await this.ctx.workingDirectory.ensure(agent);
    if (!dir) fail("拿不到当前工作区。");
    await fs.mkdir(path.join(dir, ".dsh-novel-comment"), { recursive: true }).catch(() => undefined);
    return dir;
  }

  async service(id) {
    const dir = await this.dirFor(id);
    const provider = providerFromEnv();
    const dshHome = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
    const allowedPageHosts = String(process.env.READER_PAGE_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean);
    return new ReaderService(dir, {
      ...(provider ? { reviewPort: provider } : {}),
      ...(process.env.READER_SOURCE === "fake" ? { source: new FakeSource() } : {}),
      allowedPageHosts,
      globalRoot: path.join(dshHome, "dsh-novel-comment"),
    }).init();
  }

  async status(id) {
    const service = await this.service(id);
    const readers = await service.listReaders();
    const bookRecords = await service.listBooks();
    const books = [];
    for (const book of bookRecords) {
      const chapters = await service.listChapters(book.bookId);
      books.push({
        bookId: book.bookId,
        title: book.title,
        chapters: chapters.map((chapter) => ({
          chapterId: chapter.chapterId,
          sequenceNumber: chapter.sequenceNumber,
          title: chapter.title,
          wordCount: chapter.wordCount,
        })),
      });
    }
    const quota = await service.quota();
    const ratings = await service.listRatings();
    return {
      readers: await Promise.all(
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
      ),
      books,
      quota: {
        date: quota.date,
        chapters: quota.global.chapters,
        maxChapters: quota.limits.global.chapters,
        tokens: quota.global.tokens,
        maxTokens: quota.limits.global.tokens,
      },
      recentRatings: ratings.slice(0, 8).map((rating) => ({
        readerId: rating.readerId,
        bookId: rating.target.bookId,
        chapterId: rating.target.chapterId,
        stars: rating.stars,
        status: rating.status,
        comment: rating.chapterComment,
        tasteVersion: rating.tasteVersion,
        revision: rating.target.revision ?? null,
        chapterNumber: rating.target.chapterNumber ?? null,
        segments: Array.isArray(rating.segmentComments)
          ? rating.segmentComments.map((s) => ({ quote: String(s.excerpt ?? ""), comment: String(s.comment ?? "") }))
          : [],
        at: rating.createdAt,
      })),
      readBooks: await service.readingShelf(),
      modelConfigured: Boolean(providerFromEnv()),
      dataRoot: service.dataRoot,
    };
  }

  async createReader(id, options = {}) {
    const service = await this.service(id);
    const tags = (value) =>
      Array.isArray(value)
        ? [...new Set(value.map((tag) => String(tag ?? "").trim()).filter(Boolean).map((tag) => canonicalTag(tag) ?? tag))].slice(0, 24)
        : [];
    const reader = options.templateId
      ? await service.createReaderFromTemplate(String(options.templateId), options.name ? String(options.name) : undefined)
      : await service.createReader({
          name: requireText(options, "name"),
          persona: requireText(options, "persona"),
          taste: {
            ...(tags(options.likedTags).length ? { likedTags: tags(options.likedTags).map((tagId) => ({ tagId, weight: 0.5 })) } : {}),
            ...(tags(options.dislikedTags).length ? { dislikedTags: tags(options.dislikedTags).map((tagId) => ({ tagId, weight: 0.8 })) } : {}),
          },
        });
    return { reader: { id: reader.id, name: reader.name, tasteVersion: reader.tasteVersion } };
  }

  async importChapter(id, options = {}) {
    const service = await this.service(id);
    const sequenceNumber = Number(options.sequenceNumber);
    if (!Number.isInteger(sequenceNumber) || sequenceNumber < 1) fail("sequenceNumber 必须是 >=1 的整数");
    const book = await service.importBook({ bookId: requireText(options, "bookId"), title: requireText(options, "bookTitle") });
    const chapter = await service.importChapter({
      bookId: book.bookId,
      chapterId: requireText(options, "chapterId"),
      sequenceNumber,
      title: requireText(options, "chapterTitle"),
      content: requireText(options, "content"),
    });
    return { bookId: book.bookId, chapter };
  }

  async rateChapter(id, options = {}) {
    const service = await this.service(id);
    const reader = await service.getReader(requireText(options, "readerId"));
    if (!reader) fail("读者不存在");
    const taste = await service.getTaste(reader.id);
    if (!taste) fail("读者没有口味档案");
    const bookId = requireText(options, "bookId");
    const chapterId = requireText(options, "chapterId");
    const chapter = await service.getChapter(bookId, chapterId);
    if (!chapter) fail("章节不存在");
    const stars = Number(options.stars);
    const rating = await service.saveRating({
      readerId: reader.id,
      target: {
        kind: "manuscript",
        bookId,
        chapterId,
        contentHash: chapter.contentHash,
        chapterNumber: chapter.sequenceNumber,
        revision: chapter.revision,
      },
      stars,
      chapterComment: requireText(options, "comment"),
      segmentComments: Array.isArray(options.segments)
        ? options.segments.slice(0, 3).map((s) => ({
            locator: { paragraphIndex: 0, quote: String(s.quote ?? ""), prefix: "", suffix: "" },
            excerpt: String(s.quote ?? ""),
            comment: String(s.comment ?? ""),
          }))
        : [],
      status: String(options.status || "follow"),
      dropReasonCode: options.dropReasonCode ? String(options.dropReasonCode) : undefined,
      tasteVersion: taste.version,
      model: "manual",
      promptVersion: "manual",
      usage: { inputTokens: null, outputTokens: null, source: "unknown" },
    });
    return { rating: { id: rating.id, stars: rating.stars, status: rating.status } };
  }

  async reviewChapter(id, options = {}) {
    if (!providerFromEnv()) fail("没有配置模型端点（READER_LLM_BASE_URL / READER_LLM_MODEL），只能用「手工评分」。");
    const service = await this.service(id);
    const result = await service.reviewChapter({
      readerId: requireText(options, "readerId"),
      bookId: requireText(options, "bookId"),
      chapterId: requireText(options, "chapterId"),
    });
    return {
      rating: { stars: result.rating.stars, comment: result.rating.chapterComment, status: result.rating.status },
      repaired: result.repaired,
    };
  }

  async discover(id, options = {}) {
    const service = await this.service(id);
    if (process.env.READER_SOURCE !== "fake") {
      fail("没有接入真实书源；设置 READER_SOURCE=fake 可先用内置假书源演示。");
    }
    const result = await service.discoverForReader(requireText(options, "readerId"), Number(options.limit) || 3);
    return {
      books: result.picks,
      searchedTags: result.searchedTags,
      excludedBookIds: result.excludedBookIds,
      sourceConfigured: true,
    };
  }

  /** 标签目录（六类 + 别名），面板与工具共用 */
  async tags(id) {
    const service = await this.service(id);
    return service.listTagCatalog();
  }

  /** 按标签找书（与按口味找书并存；避雷标签硬过滤） */
  async search(id, options = {}) {
    const service = await this.service(id);
    if (process.env.READER_SOURCE !== "fake") {
      fail("没有接入真实书源；设置 READER_SOURCE=fake 可先用内置假书源演示。");
    }
    const result = await service.searchByTags({
      readerId: options.readerId ? String(options.readerId) : undefined,
      tags: Array.isArray(options.tags) ? options.tags.map(String) : [],
      excludeTags: Array.isArray(options.excludeTags) ? options.excludeTags.map(String) : [],
      limit: Number(options.limit) || 5,
    });
    return {
      books: result.picks,
      searchedTags: result.searchedTags,
      unknownTags: result.unknownTags,
      excludedBookIds: result.excludedBookIds,
      sourceConfigured: true,
    };
  }

  /** 修改读者口味标签（喜好/雷点），生成新口味版本 */
  async updateTaste(id, options = {}) {
    const service = await this.service(id);
    const readerId = requireText(options, "readerId");
    const normalize = (value) => (Array.isArray(value) ? value.map((tag) => String(tag ?? "").trim()).filter(Boolean) : []);
    const taste = await service.updateReaderTags(readerId, normalize(options.likedTags), normalize(options.dislikedTags));
    return {
      readerId,
      tasteVersion: taste.version,
      likedTags: taste.likedTags.map((tag) => tag.tagId),
      dislikedTags: taste.dislikedTags.map((tag) => tag.tagId),
    };
  }

  async importUrl(id, options = {}) {
    const service = await this.service(id);
    const result = await service.importFromUrl({
      bookId: requireText(options, "bookId"),
      chapterId: requireText(options, "chapterId"),
      sequenceNumber: Number(options.sequenceNumber) || 1,
      title: requireText(options, "chapterTitle"),
      url: requireText(options, "url"),
    });
    return { bookId: result.book.bookId, chapterId: result.chapter.chapterId, wordCount: result.chapter.wordCount, host: result.page.host };
  }

  /** 加入书架：只写书目元信息，不拉外部正文 */
  async shelfAdd(id, options = {}) {
    const service = await this.service(id);
    const book = await service.addToShelf({
      bookId: requireText(options, "bookId"),
      title: requireText(options, "title"),
      author: options.author ? String(options.author) : undefined,
      tags: Array.isArray(options.tags) ? options.tags.map(String) : [],
      sourceId: options.sourceId ? String(options.sourceId) : undefined,
      sourceSite: options.sourceSite ? String(options.sourceSite) : undefined,
    });
    return { bookId: book.bookId, title: book.title, accessLevel: book.accessLevel };
  }

  /** 评论区观察：只返回关注点分布与风格提示，不保留任何评论原文 */
  async comments(id, options = {}) {
    const service = await this.service(id);
    if (process.env.READER_SOURCE !== "fake") {
      fail("没有接入真实书源；设置 READER_SOURCE=fake 可先用内置假书源演示。");
    }
    return service.learnFromComments(requireText(options, "bookId"), requireText(options, "chapterId"));
  }

  async report(id, options = {}) {
    const service = await this.service(id);
    const date = options.date ? String(options.date) : service.localDate();
    const markdown = await service.buildDailyReport(date);
    if (options.write) {
      const file = await service.writeReport(date, markdown);
      return { date, markdown, file };
    }
    return { date, markdown };
  }
}

bindRemoteMethods(
  ReaderPanelRemote,
  {
    status: "ReaderResult",
    createReader: "ReaderResult",
    importChapter: "ReaderResult",
    rateChapter: "ReaderResult",
    reviewChapter: "ReaderResult",
    report: "ReaderResult",
    discover: "ReaderResult",
    importUrl: "ReaderResult",
    shelfAdd: "ReaderResult",
    comments: "ReaderResult",
    tags: "ReaderResult",
    search: "ReaderResult",
    updateTaste: "ReaderResult",
  },
  (method, name) => Remote(name),
);

export default ReaderPanelRemote;
