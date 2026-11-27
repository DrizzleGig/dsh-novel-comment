import type { ReadingMemory, ReviewMemory, StarRating } from "../core/index.ts";

export class ReadingOrderError extends Error {
  readonly expectedSequence: number;
  readonly actualSequence: number;

  constructor(message: string, expectedSequence: number, actualSequence: number) {
    super(message);
    this.name = "ReadingOrderError";
    this.expectedSequence = expectedSequence;
    this.actualSequence = actualSequence;
  }
}

/**
 * 外部作品严格按序读：下一章必须 = 已读到 + 1。
 * 允许「先导入 1、3 章」，但读第 3 章前必须有第 2 章。
 */
export function assertNextReadingChapter(readThrough: number, targetSequence: number): void {
  if (!Number.isInteger(targetSequence) || targetSequence < 1) {
    throw new ReadingOrderError(`章节序号必须是 >=1 的整数，收到 ${targetSequence}`, readThrough + 1, targetSequence);
  }
  const expected = readThrough + 1;
  if (targetSequence !== expected) {
    throw new ReadingOrderError(
      `读者当前读到第 ${readThrough} 章，只能接着读第 ${expected} 章（请求的是第 ${targetSequence} 章）`,
      expected,
      targetSequence,
    );
  }
}

/** 作者稿评审：第 N 章必须有第 N−1 章的有效记忆（第 1 章除外） */
export function assertReviewOrder(memory: ReviewMemory | null, targetChapterNumber: number, generation: number): void {
  if (!Number.isInteger(targetChapterNumber) || targetChapterNumber < 1) {
    throw new ReadingOrderError(`章节号必须是 >=1 的整数，收到 ${targetChapterNumber}`, 1, targetChapterNumber);
  }
  if (targetChapterNumber === 1) return;
  if (!memory) {
    throw new ReadingOrderError(`还没有评审链记忆，不能直接评审第 ${targetChapterNumber} 章`, 1, targetChapterNumber);
  }
  if (memory.generation !== generation) {
    throw new ReadingOrderError(`评审链已换代（memory generation=${memory.generation}，请求=${generation}），需要重读`, 1, targetChapterNumber);
  }
  const expected = memory.validThrough + 1;
  if (targetChapterNumber !== expected) {
    throw new ReadingOrderError(
      `评审链有效读到第 ${memory.validThrough} 章，只能评第 ${expected} 章（请求的是第 ${targetChapterNumber} 章）`,
      expected,
      targetChapterNumber,
    );
  }
}

export const MEMORY_LIMITS = {
  maxUtf8Bytes: 4096,
  maxTokens: 800,
} as const;

export type TokenCountKind = "exact" | "upper-bound" | "estimated";

export interface MemoryMeasure {
  utf8Bytes: number;
  tokens: number;
  kind: TokenCountKind;
}

/**
 * 记忆有界性：注入内容 ≤4 KB 且 ≤800 tokens。
 * 没有可靠 tokenizer 时按估算并标记 estimated（不宣称精确）。
 */
export function measureMemory(memory: unknown, tokenizer?: (text: string) => number): MemoryMeasure {
  const text = typeof memory === "string" ? memory : JSON.stringify(memory);
  const utf8Bytes = new TextEncoder().encode(text).length;
  if (tokenizer) {
    return { utf8Bytes, tokens: tokenizer(text), kind: "exact" };
  }
  // 中文为主：保守按 0.8 token/字符估算，宁高不低
  return { utf8Bytes, tokens: Math.ceil([...text].length * 0.8), kind: "estimated" };
}

export function assertMemoryBounds(memory: unknown, limits = MEMORY_LIMITS): MemoryMeasure {
  const measure = measureMemory(memory);
  if (measure.utf8Bytes > limits.maxUtf8Bytes || measure.tokens > limits.maxTokens) {
    throw new Error(
      `记忆超限：${measure.utf8Bytes} 字节 / 约 ${measure.tokens} tokens（上限 ${limits.maxUtf8Bytes} 字节 / ${limits.maxTokens} tokens）`,
    );
  }
  return measure;
}

/**
 * 疲劳计数：只按「有效阅读章」累计；重试/重读不重复累计。
 * 3 星及以下 +1，4–5 星归零；上限 20，避免无限增长。
 */
export function nextFatigue(previous: number, stars: StarRating): number {
  const base = Math.max(0, Math.min(20, Math.floor(previous)));
  return stars <= 3 ? Math.min(20, base + 1) : 0;
}

/** 是否该弃书：连续 3 章 ≤2 星，或疲劳计数 ≥5 */
export function shouldDrop(fatigueCounter: number, recentStars: StarRating[]): boolean {
  const lastThree = recentStars.slice(-3);
  if (lastThree.length === 3 && lastThree.every((s) => s <= 2)) return true;
  return fatigueCounter >= 5;
}

export function emptyReadingMemory(readerId: string, bookId: string, now = new Date().toISOString()): ReadingMemory {
  return {
    schemaVersion: 2,
    id: `mem-${readerId}-${bookId}`,
    readerId,
    bookId,
    readThrough: 0,
    characters: [],
    expectations: [],
    emotionalTone: "",
    unreadQuestions: [],
    fatigueCounter: 0,
    droppedReason: null,
    updatedAt: now,
  };
}
