import type { ChapterReview, ReaderProfile } from "../core/index.ts";

/** 读者包自己拥有的数据根（相对工作区根） */
export const READER_DIR = ".dsh-novel-comment";

export interface ReaderStoreOptions {
  /** 用户工作区根目录（不含 .dsh-novel-comment） */
  workspaceRoot: string;
}

export interface ReaderSnapshot {
  profiles: ReaderProfile[];
  reviews: ChapterReview[];
}

/** 评审引擎：由调用方注入（真实 LLM 或测试桩） */
export interface ReviewEngine {
  review(input: ReviewInput): Promise<ChapterReview>;
}

export interface ReviewInput {
  profile: ReaderProfile;
  chapterId: string;
  /** 读者可见的章节正文（只含已读到的部分） */
  text: string;
  /** 读者此前读到过的内容摘要（读者记忆，不是作者记忆） */
  memory: string[];
  /** 作者对上一轮反馈的喜欢/不喜欢标记 */
  feedback?: Array<{ findingId: string; liked: boolean }>;
}
