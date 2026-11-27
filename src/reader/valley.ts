/**
 * 谷时窗口。
 *
 * 默认口径（DeepSeek 2026-09-10 起的新定价，见本机 dsh-bili-scroll 注释）：
 * 高峰 = 工作日 9:00–12:00 与 14:00–18:00，其余全部是谷时
 * （含 12:00–14:00、18:00 之后整夜、整个周末）。
 */

export interface PeakWindow {
  /** 1=周一 … 7=周日 */
  weekdays: number[];
  start: string;
  end: string;
  label?: string;
}

export interface Moment {
  /** 1=周一 … 7=周日 */
  weekday: number;
  hour: number;
  minute: number;
}

export const DEFAULT_PEAK_WINDOWS: PeakWindow[] = [
  { weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "12:00", label: "工作日上午高峰" },
  { weekdays: [1, 2, 3, 4, 5], start: "14:00", end: "18:00", label: "工作日下午高峰" },
];

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) throw new Error(`非法时间：${hhmm}`);
  return h! * 60 + m!;
}

/** 支持跨天窗口（start > end，例如 23:00–07:00） */
export function isPeak(moment: Moment, windows: PeakWindow[] = DEFAULT_PEAK_WINDOWS): boolean {
  const minutes = moment.hour * 60 + moment.minute;
  return windows.some((w) => {
    if (!w.weekdays.includes(moment.weekday)) return false;
    const start = toMinutes(w.start);
    const end = toMinutes(w.end);
    if (start <= end) return minutes >= start && minutes < end;
    return minutes >= start || minutes < end;
  });
}

export type ValleyClass = "peak" | "valley";

export function classifyMoment(moment: Moment, windows: PeakWindow[] = DEFAULT_PEAK_WINDOWS): ValleyClass {
  return isPeak(moment, windows) ? "peak" : "valley";
}

/**
 * 把时间戳换算成某个时区的「本地时刻」。
 * tzOffsetMinutes = 本地时间相对 UTC 的偏移（东八区 = 480）。
 */
export function momentFromDate(date: Date, tzOffsetMinutes: number): Moment {
  const shifted = new Date(date.getTime() + tzOffsetMinutes * 60_000);
  const jsDay = shifted.getUTCDay(); // 0=周日
  const weekday = jsDay === 0 ? 7 : jsDay;
  return { weekday, hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() };
}

/** 当前是否可自动阅读：默认只在谷时自动跑；手动触发由调用方显式 allowOutsideValley */
export function canAutoRunAt(date: Date, tzOffsetMinutes: number, windows: PeakWindow[] = DEFAULT_PEAK_WINDOWS): { allowed: boolean; class: ValleyClass; reason?: string } {
  const moment = momentFromDate(date, tzOffsetMinutes);
  const cls = classifyMoment(moment, windows);
  if (cls === "valley") return { allowed: true, class: cls };
  return { allowed: false, class: cls, reason: "当前是模型高峰时段，自动阅读会等谷时再跑（可手动跑一个小任务）" };
}
