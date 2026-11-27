import type { QuotaLimits, QuotaUsage, ReaderLimits } from "../core/index.ts";

/** 业务错误：由适配器转成 core 的 Result / PluginError */
export class ReaderLimitError extends Error {
  readonly code: "LIMIT_EXCEEDED" | "VALIDATION_FAILED" | "CONFLICT";
  readonly details?: unknown;

  constructor(code: "LIMIT_EXCEEDED" | "VALIDATION_FAILED" | "CONFLICT", message: string, details?: unknown) {
    super(message);
    this.name = "ReaderLimitError";
    this.code = code;
    this.details = details;
  }
}

/**
 * 解析使用者配置的读者上限：
 * - 允许 1..hardMax；
 * - 配置值超过硬上限时，取硬上限（不放大）；
 * - 非法值直接报错，不静默改成默认值。
 */
export function resolveReaderLimits(requested: number | undefined, defaults: ReaderLimits): ReaderLimits {
  const hard = Math.max(1, Math.floor(defaults.hardMaxReaders));
  const base = requested ?? defaults.maxReaders;
  if (!Number.isFinite(base) || base < 1) {
    throw new ReaderLimitError("VALIDATION_FAILED", `读者上限必须是 >=1 的整数，收到 ${String(requested)}`);
  }
  const max = Math.min(Math.floor(base), hard);
  return { maxReaders: max, hardMaxReaders: hard };
}

export function assertCanCreateReader(existingCount: number, limits: ReaderLimits): void {
  if (existingCount >= limits.maxReaders) {
    throw new ReaderLimitError(
      "LIMIT_EXCEEDED",
      `读者数量已达上限 ${limits.maxReaders}（硬上限 ${limits.hardMaxReaders}）`,
      { existingCount, maxReaders: limits.maxReaders, hardMaxReaders: limits.hardMaxReaders },
    );
  }
}

export interface QuotaCheck {
  ok: boolean;
  /** 第一个触顶的维度 */
  exceeded: keyof QuotaUsage | null;
  message?: string;
}

/** 检查「再加 delta 是否仍在每日上限内」；不修改 usage */
export function checkQuota(limits: QuotaLimits, usage: QuotaUsage, delta: Partial<QuotaLimits>): QuotaCheck {
  const checks: Array<[keyof QuotaLimits, number]> = [
    ["newBooks", usage.newBooks + (delta.newBooks ?? 0)],
    ["chapters", usage.chapters + (delta.chapters ?? 0)],
    ["words", usage.words + (delta.words ?? 0)],
    ["tokens", usage.tokens + (delta.tokens ?? 0)],
  ];
  for (const [key, next] of checks) {
    if (next > limits[key]) {
      return { ok: false, exceeded: key, message: `今日 ${key} 已达上限 ${limits[key]}（当前 ${usage[key]}）` };
    }
  }
  return { ok: true, exceeded: null };
}

/** 叠加用量；tokens 为 null 表示未知，必须单独计数，不能当 0 也不能当已用 */
export function addUsage(usage: QuotaUsage, delta: { newBooks?: number; chapters?: number; words?: number; tokens?: number | null }): QuotaUsage {
  return {
    newBooks: usage.newBooks + (delta.newBooks ?? 0),
    chapters: usage.chapters + (delta.chapters ?? 0),
    words: usage.words + (delta.words ?? 0),
    tokens: usage.tokens + (typeof delta.tokens === "number" ? Math.max(0, Math.floor(delta.tokens)) : 0),
    unknownTokens: usage.unknownTokens + (delta.tokens === null ? 1 : 0),
  };
}

export function emptyUsage(): QuotaUsage {
  return { newBooks: 0, chapters: 0, words: 0, tokens: 0, unknownTokens: 0 };
}
