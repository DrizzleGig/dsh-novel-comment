import type { QuotaLimits, QuotaUsage } from "../core/index.ts";
import { classifyMoment, momentFromDate, type PeakWindow } from "./valley.ts";
import { emptyUsage } from "./limits.ts";

export interface ReaderScheduleState {
  readerId: string;
  /** 该读者今日用量（没有就按 0 算） */
  usage?: QuotaUsage;
  /** 上次被调度的时间（ISO）；越早越优先 */
  lastServedAt?: string;
}

export interface ScheduleInput {
  now: Date;
  tzOffsetMinutes: number;
  windows?: PeakWindow[];
  mode: "auto" | "manual";
  limits: QuotaLimits;
  usage: QuotaUsage;
  readerLimit: QuotaLimits;
  readers: ReaderScheduleState[];
  maxSlots?: number;
}

export interface ScheduleDecision {
  allowed: boolean;
  class: "peak" | "valley";
  reason?: string;
  /** 各维度还剩多少（任一为 0 都不能再开新任务） */
  remainingByDimension: { newBooks: number; chapters: number; words: number; tokens: number };
  slots: Array<{ readerId: string; remaining: number; reason: string }>;
}

const DIMENSIONS: Array<keyof QuotaLimits> = ["newBooks", "chapters", "words", "tokens"];
const DIMENSION_LABEL: Record<keyof QuotaLimits, string> = {
  newBooks: "新书",
  chapters: "章节",
  words: "字数",
  tokens: "token",
};

/**
 * 「今天还能开几个新书任务、先轮到谁」：
 * - 自动模式只在谷时跑；峰时挂起（手动可跑小任务，但仍受同一硬上限）；
 * - **四个维度（新书/章节/字数/token）任一耗尽都不再开新任务**；
 * - 全局配额优先，再按每读者上限分配；
 * - 跨读者按「最近一次被调度」轮转，没被调度过的优先。
 */
export function planNewBookSlots(input: ScheduleInput): ScheduleDecision {
  const cls = classifyMoment(momentFromDate(input.now, input.tzOffsetMinutes), input.windows);
  const remainingByDimension = {
    newBooks: Math.max(0, input.limits.newBooks - input.usage.newBooks),
    chapters: Math.max(0, input.limits.chapters - input.usage.chapters),
    words: Math.max(0, input.limits.words - input.usage.words),
    tokens: Math.max(0, input.limits.tokens - input.usage.tokens),
  };

  if (input.mode === "auto" && cls === "peak") {
    return {
      allowed: false,
      class: cls,
      reason: "当前是模型高峰时段，自动找书会等谷时再跑（可手动跑一个小任务）",
      remainingByDimension,
      slots: [],
    };
  }

  const exhausted = DIMENSIONS.find((dimension) => remainingByDimension[dimension] === 0);
  if (exhausted) {
    return {
      allowed: false,
      class: cls,
      reason: `今日${DIMENSION_LABEL[exhausted]}配额已用完`,
      remainingByDimension,
      slots: [],
    };
  }

  const ordered = [...input.readers].sort((a, b) => {
    const at = a.lastServedAt ? Date.parse(a.lastServedAt) : 0;
    const bt = b.lastServedAt ? Date.parse(b.lastServedAt) : 0;
    return at - bt || a.readerId.localeCompare(b.readerId);
  });

  const maxSlots = Math.min(input.maxSlots ?? 3, remainingByDimension.newBooks);
  const slots: ScheduleDecision["slots"] = [];
  let left = remainingByDimension.newBooks;
  for (const reader of ordered) {
    if (slots.length >= maxSlots || left <= 0) break;
    const usage = reader.usage ?? emptyUsage();
    const readerRemaining = {
      newBooks: Math.max(0, input.readerLimit.newBooks - usage.newBooks),
      chapters: Math.max(0, input.readerLimit.chapters - usage.chapters),
      words: Math.max(0, input.readerLimit.words - usage.words),
      tokens: Math.max(0, input.readerLimit.tokens - usage.tokens),
    };
    // 每读者也要四维都还有余量；任一耗尽就跳过这个读者
    if (DIMENSIONS.some((dimension) => readerRemaining[dimension] === 0)) continue;
    slots.push({
      readerId: reader.readerId,
      remaining: Math.min(readerRemaining.newBooks, left),
      reason: reader.lastServedAt ? `上次调度：${reader.lastServedAt}` : "今天还没轮到",
    });
    left = Math.max(0, left - Math.min(readerRemaining.newBooks, left));
  }

  return {
    allowed: slots.length > 0,
    class: cls,
    reason: slots.length > 0 ? undefined : "没有可调度的读者（都到每读者上限了）",
    remainingByDimension,
    slots,
  };
}
