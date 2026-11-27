import type { ChapterReview, FindingKind, ReviewFinding } from "../core/index.ts";
import type { ReviewInput } from "./types.ts";

export interface ReviewRequest {
  system: string;
  user: string;
}

const FINDING_KINDS: FindingKind[] = ["experience", "confusion", "emotion", "anticipation", "fatigue"];

/**
 * 组装评审请求。
 * 关键约束：只把「读者已读到的内容」交给读者；不得注入作者掌握的后文。
 */
export function buildReviewRequest(input: ReviewInput): ReviewRequest {
  const { profile, text, memory, chapterId } = input;
  const memoryLine = memory.length
    ? `你已读过的前文（只能基于这些）：\n${memory.map((m, i) => `${i + 1}. ${m}`).join("\n")}`
    : `这是你读到的第一章，你对前面一无所知。`;

  const system = [
    `你是一位「${profile.name}」。`,
    `你的阅读偏好：${profile.preferences.join("、")}。`,
    `你讨厌：${profile.dislikes.join("、")}。`,
    memoryLine,
    `规则：只评价你读到的这一章；不要使用你没有读到的信息；不要编造原文。`,
    `主观阅读感受与客观事实错误要分开。`,
    `只输出 JSON，不要解释：`,
    `{"scores":{"节奏":0,"人物":0,"情节":0},"findings":[{"kind":"experience|confusion|emotion|anticipation|fatigue","excerpt":"原文摘录","note":"一句评价","anchor":{"start":0,"end":0}}]}`,
  ].join("\n");

  const user = `【章节 ${chapterId} 正文】\n${text}`;
  return { system, user };
}

/** 从可能带 markdown 包裹的文本里提取第一个 JSON 对象 */
export function extractJson(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("响应里没有 JSON 对象");
  }
  return raw.slice(start, end + 1);
}

/** 解析并校验评审结果；字段不合法时抛错，由调用方转成 VALIDATION_FAILED */
export function parseReview(raw: string, chapterId: string, profileId: string): ChapterReview {
  const obj = JSON.parse(extractJson(raw)) as {
    scores?: Record<string, number>;
    findings?: Array<Partial<ReviewFinding>>;
  };

  const scores: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj.scores ?? {})) {
    if (typeof v === "number" && Number.isFinite(v)) {
      scores[k] = Math.max(0, Math.min(10, v));
    }
  }
  if (Object.keys(scores).length === 0) {
    throw new Error("scores 为空");
  }

  const findings: ReviewFinding[] = [];
  for (const [i, f] of (obj.findings ?? []).entries()) {
    if (!f || typeof f.excerpt !== "string" || typeof f.note !== "string") continue;
    const kind: FindingKind = FINDING_KINDS.includes(f.kind as FindingKind)
      ? (f.kind as FindingKind)
      : "experience";
    findings.push({
      id: `${chapterId}-${i + 1}`,
      kind,
      excerpt: f.excerpt.slice(0, 500),
      note: f.note.slice(0, 500),
      anchor:
        f.anchor && Number.isInteger(f.anchor.start) && Number.isInteger(f.anchor.end)
          ? { start: f.anchor.start as number, end: f.anchor.end as number }
          : undefined,
    });
  }

  return {
    id: `${chapterId}--${profileId}`,
    chapterId,
    profileId,
    scores,
    findings,
    createdAt: new Date().toISOString(),
  };
}
