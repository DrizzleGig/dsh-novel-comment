import type { DropReasonCode, StarRating } from "../core/index.ts";

export interface DailyReportEntry {
  bookId: string;
  title: string;
  author?: string;
  readToChapter: number;
  totalChapters?: number;
  stars: StarRating;
  status: "follow" | "watch" | "drop";
  note: string;
  segmentComments?: number;
  dropReasonCode?: DropReasonCode;
}

export interface DailyReportSkipped {
  bookId?: string;
  reason: string;
  detail?: string;
}

const DROP_REASON_TEXT: Record<DropReasonCode, string> = {
  slow_pacing: "节奏慢",
  character_break: "人设崩",
  logic_error: "逻辑硬伤",
  prose: "文笔",
  formulaic: "套路重复",
  genre_mismatch: "题材不合",
  other: "其他",
};

/**
 * 日报格式：每条一条 `### <bookId>` 标题行（宿主用它计数/列表），下面是这本书的阅读结果。
 * 只写 reader 自己的判断与短摘录，不附任何外部书正文。
 */
export function renderDailyReport(date: string, entries: DailyReportEntry[], skipped: DailyReportSkipped[] = []): string {
  const lines: string[] = [];
  lines.push(`# 读者日报 — ${date}`);
  lines.push("");
  const chapterTotal = entries.reduce((sum, e) => sum + e.readToChapter, 0);
  lines.push(`今天读了 ${entries.length} 本、共 ${chapterTotal} 章。`);
  lines.push("");

  for (const entry of entries) {
    lines.push(`### ${entry.bookId}`);
    lines.push("");
    lines.push(`- 书名：${entry.title}${entry.author ? `（${entry.author}）` : ""}`);
    lines.push(`- 读到：第 ${entry.readToChapter} 章${entry.totalChapters ? ` / 共 ${entry.totalChapters} 章` : ""}`);
    const statusText = entry.status === "follow" ? "追更" : entry.status === "watch" ? "观望" : "弃书";
    lines.push(`- 评分：${entry.stars} 星（${statusText}）`);
    if (entry.segmentComments) lines.push(`- 段评：${entry.segmentComments} 条`);
    if (entry.dropReasonCode) lines.push(`- 弃书原因：${DROP_REASON_TEXT[entry.dropReasonCode]}`);
    lines.push(`- 一句话：${entry.note}`);
    lines.push("");
  }

  if (skipped.length > 0) {
    lines.push("## 跳过");
    lines.push("");
    for (const s of skipped) {
      lines.push(`- ${s.bookId ? `${s.bookId}：` : ""}${s.reason}${s.detail ? `（${s.detail}）` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
