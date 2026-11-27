import type { SourceStopReason } from "../core/index.ts";
import type { CandidateBook } from "./discover.ts";
import type { RawComment } from "./comments.ts";

export interface BookSearch {
  /** 书名 / 作者关键词 */
  text?: string;
  /** 规范标签（必选） */
  tags?: string[];
  limit?: number;
}

export interface SearchResult {
  book: CandidateBook;
  sourceId: string;
  sourceSite: string;
}

export interface ChapterFetch {
  bookId: string;
  chapterId: string;
  sequenceNumber: number;
  title: string;
  content: string;
  contentHash: string;
}

/** 书源停止（付费墙/验证码/风控/结构变化…）：调用方必须停，不许重试硬闯 */
export class SourceStopError extends Error {
  readonly reason: SourceStopReason;

  constructor(reason: SourceStopReason, message: string) {
    super(message);
    this.name = "SourceStopError";
    this.reason = reason;
  }
}

/**
 * 书源适配器：L1（搜索）/ L2（公开站）由它实现。
 * 只允许访问配置内的站点；拿到验证码/付费墙/风控必须抛 SourceStopError。
 */
export interface SourceAdapter {
  readonly id: string;
  /** 能力声明：搜索 / 读章 / 读评论 */
  readonly capabilities: { search: boolean; readChapter: boolean; readComments: boolean };
  search(query: BookSearch, signal?: AbortSignal): Promise<SearchResult[]>;
  fetchChapter(bookId: string, chapterId: string, signal?: AbortSignal): Promise<ChapterFetch>;
  fetchComments(bookId: string, chapterId: string, signal?: AbortSignal): Promise<RawComment[]>;
}
