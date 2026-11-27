/**
 * 真实评审引擎：组装提示词 → 调模型 → 严格校验结构化输出 → 一次修复。
 *
 * 铁律：
 * - 只给「读者已读到的内容」：人格 + 口味 + 前驱记忆 + 本章正文；不给后文、大纲、作者设定。
 * - 星级/评论/段评/弃书原因全部严格校验，不 clamp、不补默认；不合规就修复一次，仍不合规就失败。
 * - 记忆由模型给出「候选内容」，程序负责边界（条数/长度/疲劳计数）与落盘。
 */
import type {
  ChapterRating,
  DropReasonCode,
  RatingStatus,
  RatingTarget,
  ReadingMemory,
  ReviewMemory,
  SegmentComment,
  StarRating,
  TasteProfile,
  TokenUsage,
} from "../core/index.ts";
import type { ReaderAgent } from "../core/index.ts";
import { buildRating } from "./rating.ts";
import type { RatingDraft } from "./rating.ts";
import { locateAnchor } from "./locate.ts";
import { nextFatigue } from "./reading.ts";

export interface ReviewModelRequest {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  maxOutputTokens: number;
}

export interface ReviewModelResponse {
  text: string;
  model: string;
  usage: TokenUsage;
}

/** 模型端口：由宿主注入（DSH 模型能力 / OpenAI 兼容端点 / 测试桩） */
export interface ReviewModelPort {
  readonly id: string;
  readonly model: string;
  generate(request: ReviewModelRequest, options?: { signal?: AbortSignal }): Promise<ReviewModelResponse>;
}

export interface ReviewPromptInput {
  reader: ReaderAgent;
  taste: TasteProfile;
  /** 评审链记忆（第 N−1 章及之前）；第 1 章为 null */
  reviewMemory: ReviewMemory | null;
  bookId: string;
  chapterId: string;
  chapterNumber: number;
  title: string;
  content: string;
}

export interface ReviewMemoryCandidate {
  characters: ReadingMemory["characters"];
  expectations: string[];
  emotionalTone: string;
  unreadQuestions: string[];
}

export interface ReviewDraft {
  stars: StarRating;
  chapterComment: string;
  segmentComments: SegmentComment[];
  status: RatingStatus;
  dropReasonCode?: DropReasonCode;
  memory: ReviewMemoryCandidate;
}

export class ReviewModelError extends Error {
  readonly detail: string;

  constructor(message: string, detail = "") {
    super(message);
    this.name = "ReviewModelError";
    this.detail = detail;
  }
}

const SYSTEM = `你是一位真实的网文读者，只评价你刚读完的这一章。
规则：
1. 你只能使用「你的口味」和「你读过的前文记忆」，绝不能引用或假设后面的剧情。
2. 只输出一个 JSON 对象，不要 markdown 代码块、不要解释。
3. 星级 1–5 的整数；必须在 chapterComment 里说明为什么不是上一档/下一档。
4. 段评必须引用本章原文（15–40 字），quote 必须是正文里逐字存在的片段。
5. 弃书（status=drop）必须给 dropReasonCode：slow_pacing / character_break / logic_error / prose / formulaic / genre_mismatch / other。
6. memory 是你读完这一章后的记忆，不是作者设定：characters 只记你见过/推断出的人物，expectations 最多 8 条，unreadQuestions 最多 8 条。`;

export function buildReviewPrompt(input: ReviewPromptInput): ReviewModelRequest {
  const { reader, taste, reviewMemory, content, chapterNumber, title } = input;
  const memoryLines = reviewMemory?.entries?.length
    ? reviewMemory.entries.map((e) => `第 ${e.chapterNumber} 章后：${e.memory}`).join("\n")
    : "这是你读到的第一章，你对之前一无所知。";
  const liked = taste.likedTags.map((t) => `${t.tagId}(${t.weight.toFixed(2)})`).join("、") || "（没有特别偏好）";
  const disliked = taste.dislikedTags.map((t) => `${t.tagId}(${t.weight.toFixed(2)})`).join("、") || "（没有明确雷点）";
  const system = [
    SYSTEM,
    `你的名字：${reader.name}`,
    `你的人设：${reader.persona}`,
    `你喜欢：${liked}`,
    `你讨厌：${disliked}`,
    `你的评论风格：${taste.commentStyle.join("、") || "自然口语"}`,
    `前文记忆：\n${memoryLines}`,
    `输出 JSON 结构：{"stars":1-5,"chapterComment":"...","status":"follow|watch|drop","dropReasonCode":"...可选","segments":[{"quote":"...","prefix":"","suffix":"","paragraphIndex":0,"comment":"..."}],"memory":{"characters":[{"name":"...","belief":"...","confidence":"observed|inferred"}],"expectations":["..."],"emotionalTone":"...","unreadQuestions":["..."]}}`,
  ].join("\n\n");
  const user = `【第 ${chapterNumber} 章 · ${title}】\n${content}`;
  return {
    model: "reviewer",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxOutputTokens: 2400,
  };
}

/** 从可能带 markdown/解释的文本里提取第一个平衡的 JSON 对象 */
export function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      /* 继续做平衡扫描 */
    }
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fence?.[1]?.trim() ?? raw;
  const start = candidate.indexOf("{");
  if (start === -1) throw new ReviewModelError("模型输出里没有 JSON 对象", raw.slice(0, 200));
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  throw new ReviewModelError("模型输出的 JSON 不完整", raw.slice(0, 200));
}

function asString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new ReviewModelError(`${field} 必须是字符串`);
  const text = value.trim();
  if (!text) throw new ReviewModelError(`${field} 不能为空`);
  if (text.length > max) throw new ReviewModelError(`${field} 超过 ${max} 字`);
  return text;
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

/** 解析并严格校验模型输出；任何不合规都抛错（由调用方决定是否修复重试） */
export function parseReviewDraft(raw: string, input: ReviewPromptInput): ReviewDraft {
  const json = extractJsonObject(raw);
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(json) as Record<string, unknown>;
  } catch (error) {
    throw new ReviewModelError(`JSON 解析失败：${(error as Error).message}`);
  }

  const stars = obj.stars;
  if (typeof stars !== "number" || !Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new ReviewModelError(`星级必须是 1–5 的整数，收到 ${JSON.stringify(stars)}`);
  }
  const chapterComment = asString(obj.chapterComment, "chapterComment", 200);
  const status = obj.status;
  if (status !== "follow" && status !== "watch" && status !== "drop") {
    throw new ReviewModelError(`status 非法：${JSON.stringify(status)}`);
  }
  let dropReasonCode: DropReasonCode | undefined;
  if (status === "drop") {
    if (typeof obj.dropReasonCode !== "string" || !DROP_REASONS.includes(obj.dropReasonCode as DropReasonCode)) {
      throw new ReviewModelError(`弃书必须给合法 dropReasonCode，收到 ${JSON.stringify(obj.dropReasonCode)}`);
    }
    dropReasonCode = obj.dropReasonCode as DropReasonCode;
  }

  const segmentsRaw = obj.segments;
  if (segmentsRaw !== undefined && !Array.isArray(segmentsRaw)) throw new ReviewModelError("segments 必须是数组");
  const segmentsList = (segmentsRaw as unknown[] | undefined) ?? [];
  if (segmentsList.length > 3) throw new ReviewModelError("段评最多 3 条");
  const segmentComments: SegmentComment[] = segmentsList.map((item, index) => {
    const seg = item as Record<string, unknown>;
    const quote = asString(seg.quote, `segments[${index}].quote`, 200);
    const paragraphIndex = seg.paragraphIndex;
    if (typeof paragraphIndex !== "number" || !Number.isInteger(paragraphIndex) || paragraphIndex < 0) {
      throw new ReviewModelError(`segments[${index}].paragraphIndex 必须是非负整数`);
    }
    const prefix = typeof seg.prefix === "string" ? seg.prefix.slice(0, 10) : "";
    const suffix = typeof seg.suffix === "string" ? seg.suffix.slice(0, 10) : "";
    const located = locateAnchor(input.content, { quote, prefix, suffix, paragraphIndex });
    if (located.match !== "exact" && located.match !== "normalized") {
      throw new ReviewModelError(`segments[${index}] 引用无法在正文定位（${located.match}）`);
    }
    const comment = asString(seg.comment, `segments[${index}].comment`, 100);
    return { locator: { paragraphIndex, quote, prefix, suffix }, excerpt: quote, comment };
  });

  const memoryRaw = obj.memory;
  if (!memoryRaw || typeof memoryRaw !== "object") throw new ReviewModelError("缺少 memory");
  const memoryObj = memoryRaw as Record<string, unknown>;
  const charactersRaw = memoryObj.characters;
  if (!Array.isArray(charactersRaw) || charactersRaw.length > 20) throw new ReviewModelError("memory.characters 必须是最多 20 条的数组");
  const characters = charactersRaw.map((item, index) => {
    const c = item as Record<string, unknown>;
    if (typeof c.name !== "string" || !c.name.trim()) throw new ReviewModelError(`memory.characters[${index}].name 非法`);
    if (typeof c.belief !== "string" || !c.belief.trim()) throw new ReviewModelError(`memory.characters[${index}].belief 非法`);
    if (c.confidence !== "observed" && c.confidence !== "inferred") {
      throw new ReviewModelError(`memory.characters[${index}].confidence 必须是 observed/inferred`);
    }
    return { name: c.name.trim().slice(0, 40), belief: c.belief.trim().slice(0, 120), confidence: c.confidence as "observed" | "inferred" };
  });
  const stringList = (value: unknown, field: string, maxItems: number): string[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new ReviewModelError(`${field} 必须是数组`);
    if (value.length > maxItems) throw new ReviewModelError(`${field} 最多 ${maxItems} 条`);
    return value.map((v, i) => asString(v, `${field}[${i}]`, 120));
  };
  const expectations = stringList(memoryObj.expectations, "memory.expectations", 8);
  const unreadQuestions = stringList(memoryObj.unreadQuestions, "memory.unreadQuestions", 8);
  const emotionalTone = memoryObj.emotionalTone === undefined ? "" : asString(memoryObj.emotionalTone, "memory.emotionalTone", 80);

  return {
    stars: stars as StarRating,
    chapterComment,
    segmentComments,
    status,
    dropReasonCode,
    memory: { characters, expectations, emotionalTone, unreadQuestions },
  };
}

export interface GeneratedReview {
  draft: ReviewDraft;
  response: ReviewModelResponse;
  repaired: boolean;
}

/**
 * 调模型并校验；失败时把错误列表交回模型修复一次。
 * 修复仍失败 → 抛 ReviewModelError（调用方记账为 unknown/失败，不生成有效评分）。
 */
export async function generateReview(port: ReviewModelPort, input: ReviewPromptInput, options?: { signal?: AbortSignal }): Promise<GeneratedReview> {
  const request = buildReviewPrompt(input);
  const first = await port.generate(request, options);
  try {
    return { draft: parseReviewDraft(first.text, input), response: first, repaired: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const repair: ReviewModelRequest = {
      ...request,
      messages: [
        ...request.messages,
        { role: "user", content: `你上一次的输出不合规：${message}\n请只输出修正后的 JSON，不要解释。` },
        { role: "user", content: `上次输出：\n${first.text.slice(0, 4000)}` },
      ],
    };
    const second = await port.generate(repair, options);
    try {
      return { draft: parseReviewDraft(second.text, input), response: second, repaired: true };
    } catch (secondError) {
      throw new ReviewModelError(
        `模型输出两次都不合规：${secondError instanceof Error ? secondError.message : String(secondError)}`,
        second.text.slice(0, 300),
      );
    }
  }
}

export interface ReviewCommitContext {
  readerId: string;
  target: RatingTarget;
  tasteVersion: string;
  providerId: string;
  model: string;
}

export function draftToRating(draft: ReviewDraft, context: ReviewCommitContext, usage: TokenUsage): RatingDraft {
  return {
    readerId: context.readerId,
    target: context.target,
    stars: draft.stars,
    chapterComment: draft.chapterComment,
    segmentComments: draft.segmentComments,
    status: draft.status,
    dropReasonCode: draft.dropReasonCode,
    tasteVersion: context.tasteVersion,
    model: `${context.providerId}:${context.model}`,
    promptVersion: "review-v1",
    usage,
  };
}

/** 把模型给的记忆候选合并进该读者的阅读记忆（边界由程序控制） */
export function mergeReviewMemory(
  previous: ReadingMemory,
  draft: ReviewDraft,
  chapter: { bookId: string; sequenceNumber: number },
  now: string,
): ReadingMemory {
  return {
    ...previous,
    readThrough: chapter.sequenceNumber,
    characters: draft.memory.characters,
    expectations: draft.memory.expectations,
    emotionalTone: draft.memory.emotionalTone,
    unreadQuestions: draft.memory.unreadQuestions,
    fatigueCounter: nextFatigue(previous.fatigueCounter, draft.stars),
    droppedReason: draft.status === "drop" ? (draft.dropReasonCode ?? "other") : previous.droppedReason,
    updatedAt: now,
  };
}

/** 评审链推进：第 N 章的有效记忆变成第 N 章后的一句话记忆 */
export function advanceReviewMemory(previous: ReviewMemory | null, draft: ReviewDraft, chapter: { bookId: string; readerId: string; chapterNumber: number }, now: string): ReviewMemory {
  const summary = [
    `星级 ${draft.stars}`,
    draft.chapterComment,
    draft.memory.expectations.length ? `期待：${draft.memory.expectations.join("；")}` : "",
    draft.memory.unreadQuestions.length ? `悬念：${draft.memory.unreadQuestions.join("；")}` : "",
  ]
    .filter(Boolean)
    .join("｜")
    .slice(0, 500);
  const entries = [...(previous?.entries ?? []), { chapterNumber: chapter.chapterNumber, memory: summary }].slice(-50);
  return {
    schemaVersion: 2,
    id: previous?.id ?? `review-mem-${chapter.readerId}-${chapter.bookId}`,
    readerId: chapter.readerId,
    bookId: chapter.bookId,
    generation: previous?.generation ?? 1,
    validThrough: chapter.chapterNumber,
    invalidFrom: null,
    entries,
    updatedAt: now,
  };
}

export function ratingTargetFor(chapter: { bookId: string; chapterId: string; contentHash: string; sequenceNumber: number; revision: number }): RatingTarget {
  return {
    kind: "manuscript",
    bookId: chapter.bookId,
    chapterId: chapter.chapterId,
    contentHash: chapter.contentHash,
    chapterNumber: chapter.sequenceNumber,
    revision: chapter.revision,
  };
}

export type { ChapterRating };
