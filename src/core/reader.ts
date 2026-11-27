/**
 * reader（AI 读者）领域 DTO —— 与 `.dsh-novel-comment/` 的数据一一对应。
 *
 * 设计口径（2026-11-27 修正版）：
 * - 读者 = 书外人设 + 会演化的口味 + 独立记忆；数量由使用者决定，有上限。
 * - 评分 = 1–5 整星 + 章评 +（可选）段评 + 追更/观望/弃书；没有固定五维。
 * - 外部作品阅读与作者稿评审共用评分结构，但记忆与目标类型分开。
 */

/* --------------------------------- 读者 ---------------------------------- */

export type ReaderStatus = "active" | "paused" | "deleted";

export interface ReaderLimits {
  /** 使用者可配置的创建上限 */
  maxReaders: number;
  /** 硬上限，任何配置都不能超过 */
  hardMaxReaders: number;
}

export const DEFAULT_READER_LIMITS: ReaderLimits = { maxReaders: 8, hardMaxReaders: 16 };

export interface ReaderAgent {
  schemaVersion: 2;
  id: string;
  name: string;
  status: ReaderStatus;
  /** 预置模板 id（binge/emotion/plot/…），自建读者为空 */
  personaTemplateId?: string;
  /** 一句话人设：稳定，不随口味漂移 */
  persona: string;
  revision: number;
  /** 当前口味版本（指向 taste 的 version） */
  tasteVersion: string;
  createdAt: string;
}

/* --------------------------------- 口味 ---------------------------------- */

export interface TasteTagWeight {
  tagId: string;
  /** 0–1，偏好强度 */
  weight: number;
}

export interface TasteProfile {
  schemaVersion: 2;
  readerId: string;
  /** 不可变版本号（内容哈希短串） */
  version: string;
  parentVersion: string | null;
  likedTags: TasteTagWeight[];
  dislikedTags: TasteTagWeight[];
  likedAuthors: string[];
  dislikedAuthors: string[];
  likedTropes: string[];
  dislikedTropes: string[];
  /** 节奏耐受，例如 "slow-burn-ok" / "needs-hook-every-2k" */
  pacingTolerance: string[];
  sensitivities: {
    prose: string[];
    dialogue: string[];
    setting: string[];
  };
  /** 评论风格：毒舌/温和/考据… */
  commentStyle: string[];
  /** 支撑本次版本的评分 id */
  evidenceRatingIds: string[];
  updatedAt: string;
}

/* --------------------------------- 定位 ---------------------------------- */

export interface TextLocator {
  /** 0 起；按「空行分段」协议 paragraphProtocol 计算 */
  paragraphIndex: number;
  /** 原文摘录，15–40 个字形；极短整段可 shortQuote */
  quote: string;
  /** 前后文，各最多 10 个字形 */
  prefix: string;
  suffix: string;
}

export type AnchorMatch = "exact" | "normalized" | "ambiguous" | "unmatched";

export interface SegmentComment {
  locator: TextLocator;
  /** 引用到的原文（展示用，长度受限） */
  excerpt: string;
  comment: string;
}

/* --------------------------------- 评分 ---------------------------------- */

export type StarRating = 1 | 2 | 3 | 4 | 5;
export type RatingStatus = "follow" | "watch" | "drop";

export type DropReasonCode =
  | "slow_pacing"
  | "character_break"
  | "logic_error"
  | "prose"
  | "formulaic"
  | "genre_mismatch"
  | "other";

export interface RatingTargetBase {
  bookId: string;
  chapterId: string;
  /** 该章正文的内容指纹 */
  contentHash: string;
}

/** 外部作品（养成用） */
export interface ExternalChapterTarget extends RatingTargetBase {
  kind: "external";
  sourceId: string;
}

/** 作者自己的稿（评审用） */
export interface ManuscriptChapterTarget extends RatingTargetBase {
  kind: "manuscript";
  chapterNumber: number;
  /** 稿件版本 */
  revision: number;
}

export type RatingTarget = ExternalChapterTarget | ManuscriptChapterTarget;

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  /** provider=真实返回；estimated=估算；unknown=拿不到（绝不能当 0） */
  source: "provider" | "estimated" | "unknown";
}

export interface ChapterRating {
  schemaVersion: 2;
  id: string;
  readerId: string;
  target: RatingTarget;
  stars: StarRating;
  /** 章评：整章感受 */
  chapterComment: string;
  /** 段评：0–3 条 */
  segmentComments: SegmentComment[];
  status: RatingStatus;
  /** status=drop 时必填 */
  dropReasonCode?: DropReasonCode;
  /** 评分时使用的口味版本 */
  tasteVersion: string;
  model: string;
  promptVersion: string;
  usage: TokenUsage;
  createdAt: string;
}

/** 评分的展示视图：带定位状态与失效原因 */
export interface RatingView {
  rating: ChapterRating;
  anchors: Array<{ index: number; match: AnchorMatch }>;
  freshness: "current" | "stale" | "legacy-unverifiable";
  staleReasons: Array<"chapter_changed" | "taste_changed" | "superseded">;
}

/* --------------------------------- 记忆 ---------------------------------- */

export interface ReaderCharacterBelief {
  name: string;
  /** 这个读者以为的人设 */
  belief: string;
  /** observed=正文里看到的；inferred=自己猜的 */
  confidence: "observed" | "inferred";
}

/** 阅读记忆：读者对外部书籍的记忆（只属于这个读者） */
export interface ReadingMemory {
  schemaVersion: 2;
  id: string;
  readerId: string;
  bookId: string;
  /** 读到第几章（按 sequenceNumber） */
  readThrough: number;
  characters: ReaderCharacterBelief[];
  expectations: string[];
  emotionalTone: string;
  unreadQuestions: string[];
  /** 连续平淡章数，用于弃书判断 */
  fatigueCounter: number;
  /** 换书/弃书原因（没有则 null） */
  droppedReason: DropReasonCode | null;
  updatedAt: string;
}

/** 评审记忆：读者对作者稿的记忆（防后文泄漏，按评审链隔离） */
export interface ReviewMemory {
  schemaVersion: 2;
  id: string;
  readerId: string;
  bookId: string;
  /** 评审链代数；稿件改动会递增 */
  generation: number;
  /** 有效读到第几章 */
  validThrough: number;
  /** 无效起点（null=没有失效） */
  invalidFrom: number | null;
  /** 每章一条，只保留压缩记忆文本 */
  entries: Array<{ chapterNumber: number; memory: string }>;
  updatedAt: string;
}

/* --------------------------------- 配额 ---------------------------------- */

export interface QuotaLimits {
  /** 每天允许开启的「读者-书籍」新任务数 */
  newBooks: number;
  chapters: number;
  words: number;
  tokens: number;
}

export interface QuotaUsage {
  newBooks: number;
  chapters: number;
  words: number;
  /** 已知 token 用量 */
  tokens: number;
  /** 拿不到用量的次数（未知不等于 0） */
  unknownTokens: number;
}

export interface QuotaLedger {
  /** 本地日期 YYYY-MM-DD */
  date: string;
  usage: QuotaUsage;
}

export const DEFAULT_GLOBAL_QUOTA: QuotaLimits = {
  newBooks: 3,
  chapters: 20,
  words: 60_000,
  tokens: 120_000,
};

export const DEFAULT_READER_QUOTA: QuotaLimits = {
  newBooks: 1,
  chapters: 5,
  words: 15_000,
  tokens: 30_000,
};

/* -------------------------------- 书与章节 -------------------------------- */

export interface BookRecord {
  schemaVersion: 2;
  bookId: string;
  title: string;
  author?: string;
  sourceId?: string;
  sourceSite?: string;
  /** 站点可见标签（未匹配的不要冒充已知） */
  tags: string[];
  accessLevel: "imported" | "public" | "authorized";
  addedAt: string;
}

export interface ChapterRecord {
  schemaVersion: 2;
  chapterId: string;
  sequenceNumber: number;
  title: string;
  /** 从 1 起；改稿 +1 */
  revision: number;
  contentHash: string;
  wordCount: number;
  importedAt: string;
  /** 公开页导入：只保存短摘录，不存全文 */
  contentOrigin?: "imported" | "public-page";
  excerpt?: string;
}

/* ------------------------------ 书源停止原因 ------------------------------ */

export type SourceStopReason =
  | "paywall"
  | "captcha"
  | "risk_control"
  | "layout_changed"
  | "rate_limited"
  | "unsupported"
  | "temporarily_unavailable";

export interface SourceStop {
  reason: SourceStopReason;
  message: string;
}

/* -------------------------------- 分歧比较 ------------------------------- */

export type ComparisonAttribution = "taste_difference" | "manuscript_change" | "mixed_change" | "incomparable";

export interface RatingComparisonInput {
  bookId: string;
  chapterId: string;
  /** 当前展示的稿件版本；外部作品可相同 */
  targetRevision: number;
  items: Array<{
    readerId: string;
    readerName: string;
    tasteVersion: string;
    /** 这条评分对应的稿件版本；不填则用 targetRevision */
    revision?: number;
    stars: StarRating;
    chapterComment: string;
    segmentComments: SegmentComment[];
  }>;
}
