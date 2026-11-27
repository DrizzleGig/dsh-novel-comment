import type {
  ChapterRating,
  DropReasonCode,
  RatingStatus,
  RatingTarget,
  SegmentComment,
  StarRating,
  TokenUsage,
} from "../core/index.ts";
import { shortHash } from "./hash.ts";

export const MAX_CHAPTER_COMMENT = 200;
export const MAX_SEGMENT_COMMENT = 100;
export const MAX_SEGMENTS = 3;
export const MAX_QUOTE = 200;
export const MAX_CONTEXT = 10;

export class RatingValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "RatingValidationError";
    this.field = field;
  }
}

const DROP_REASONS: DropReasonCode[] = [
  "slow_pacing",
  "character_break",
  "logic_error",
  "prose",
  "formulaic",
  "genre_mismatch",
  "other",
];

const STATUSES: RatingStatus[] = ["follow", "watch", "drop"];

/**
 * 星级必须是有且仅有 1–5 的整数。
 * 不做 clamp、不默认补 3 星：越界就是错误，交给调用方报 VALIDATION_FAILED。
 */
export function validateStars(value: unknown): StarRating {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new RatingValidationError("stars", `星级必须是 1–5 的整数，收到 ${JSON.stringify(value)}`);
  }
  return value as StarRating;
}

export function validateStatus(value: unknown): RatingStatus {
  if (typeof value !== "string" || !STATUSES.includes(value as RatingStatus)) {
    throw new RatingValidationError("status", `阅读状态必须是 ${STATUSES.join(" / ")} 之一，收到 ${JSON.stringify(value)}`);
  }
  return value as RatingStatus;
}

export function validateDropReason(status: RatingStatus, value: unknown): DropReasonCode | undefined {
  if (status !== "drop") return undefined;
  if (typeof value !== "string" || !DROP_REASONS.includes(value as DropReasonCode)) {
    throw new RatingValidationError("dropReasonCode", `弃书必须给出原因码（${DROP_REASONS.join(" / ")}），收到 ${JSON.stringify(value)}`);
  }
  return value as DropReasonCode;
}

function cleanText(value: unknown, field: string, max: number, required: boolean): string {
  if (typeof value !== "string") {
    if (required) throw new RatingValidationError(field, `${field} 必须是字符串`);
    return "";
  }
  const text = value.trim();
  if (required && text.length === 0) throw new RatingValidationError(field, `${field} 不能为空`);
  if (text.length > max) throw new RatingValidationError(field, `${field} 超过 ${max} 字上限（当前 ${text.length}）`);
  return text;
}

export function validateSegmentComments(value: unknown): SegmentComment[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new RatingValidationError("segmentComments", "段评必须是数组");
  if (value.length > MAX_SEGMENTS) {
    throw new RatingValidationError("segmentComments", `段评最多 ${MAX_SEGMENTS} 条（收到 ${value.length}）`);
  }
  return value.map((raw, index) => {
    const item = raw as Partial<SegmentComment> | null;
    if (!item || typeof item !== "object") throw new RatingValidationError(`segmentComments[${index}]`, "段评必须是对象");
    const locator = item.locator;
    if (!locator || typeof locator !== "object") throw new RatingValidationError(`segmentComments[${index}].locator`, "段评缺少 locator");
    if (!Number.isInteger(locator.paragraphIndex) || locator.paragraphIndex < 0) {
      throw new RatingValidationError(`segmentComments[${index}].locator.paragraphIndex`, "paragraphIndex 必须是非负整数");
    }
    const quote = cleanText(locator.quote, `segmentComments[${index}].locator.quote`, MAX_QUOTE, true);
    const prefix = cleanText(typeof locator.prefix === "string" ? locator.prefix : "", `segmentComments[${index}].locator.prefix`, MAX_CONTEXT, false);
    const suffix = cleanText(typeof locator.suffix === "string" ? locator.suffix : "", `segmentComments[${index}].locator.suffix`, MAX_CONTEXT, false);
    const excerpt = cleanText(item.excerpt, `segmentComments[${index}].excerpt`, MAX_QUOTE, true);
    const comment = cleanText(item.comment, `segmentComments[${index}].comment`, MAX_SEGMENT_COMMENT, true);
    return {
      locator: { paragraphIndex: locator.paragraphIndex, quote, prefix, suffix },
      excerpt,
      comment,
    };
  });
}

export interface RatingDraft {
  readerId: string;
  target: RatingTarget;
  stars: unknown;
  chapterComment: unknown;
  segmentComments?: unknown;
  status: unknown;
  dropReasonCode?: unknown;
  tasteVersion: string;
  model: string;
  promptVersion: string;
  usage?: TokenUsage;
  now?: string;
}

/** 校验并生成一条评分；任何字段不合法都抛 RatingValidationError，不静默修补 */
export function buildRating(draft: RatingDraft): ChapterRating {
  const stars = validateStars(draft.stars);
  const status = validateStatus(draft.status);
  const dropReasonCode = validateDropReason(status, draft.dropReasonCode);
  const chapterComment = cleanText(draft.chapterComment, "chapterComment", MAX_CHAPTER_COMMENT, true);
  const segmentComments = validateSegmentComments(draft.segmentComments);
  const now = draft.now ?? new Date().toISOString();
  const usage: TokenUsage = draft.usage ?? { inputTokens: null, outputTokens: null, source: "unknown" };
  const seed = [
    draft.readerId,
    draft.target.bookId,
    draft.target.chapterId,
    draft.target.contentHash,
    draft.tasteVersion,
    stars,
    now,
    chapterComment,
  ].join("|");
  return {
    schemaVersion: 2,
    id: `rating-${shortHash(seed)}`,
    readerId: draft.readerId,
    target: draft.target,
    stars,
    chapterComment,
    segmentComments,
    status,
    dropReasonCode,
    tasteVersion: draft.tasteVersion,
    model: draft.model,
    promptVersion: draft.promptVersion,
    usage,
    createdAt: now,
  };
}

/** 星级语义（写进提示词与 UI，保证读者有立场、不中庸） */
export const STAR_MEANING: Record<StarRating, string> = {
  1: "看不下去，直接弃",
  2: "有明显劝退点，勉强",
  3: "平平，能看但不出彩",
  4: "喜欢，有亮点，会追",
  5: "上头，强烈推荐",
};
