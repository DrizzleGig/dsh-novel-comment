import type { ComparisonAttribution, RatingComparisonInput } from "../core/index.ts";

export interface ComparisonResult {
  attribution: ComparisonAttribution;
  /** 每人一行，按星级降序（只做展示，不做加权平均分） */
  rows: Array<{
    readerId: string;
    readerName: string;
    stars: number;
    revision: number;
    chapterComment: string;
    segmentComments: number;
    tasteVersion: string;
  }>;
  /** 星级极差（最高-最低）；只有 1 条时为 0 */
  spread: number;
  notes: string[];
}

/**
 * 分歧比较的归因规则：
 * - 不同读者 + 同一稿件版本 → taste_difference（口味差异）
 * - 同一读者 + 不同稿件版本 → manuscript_change（稿件变化）
 * - 两者都不同 → mixed_change（混合变化，无法单独归因）
 * - 只有一条 → incomparable
 */
export function compareRatings(input: RatingComparisonInput): ComparisonResult {
  const rows = input.items
    .map((item) => ({
      readerId: item.readerId,
      readerName: item.readerName,
      stars: item.stars as number,
      revision: item.revision ?? input.targetRevision,
      chapterComment: item.chapterComment,
      segmentComments: item.segmentComments.length,
      tasteVersion: item.tasteVersion,
    }))
    .sort((a, b) => b.stars - a.stars || (a.readerId < b.readerId ? -1 : 1));

  const readerCount = new Set(rows.map((r) => r.readerId)).size;
  const revisionCount = new Set(rows.map((r) => r.revision)).size;
  const tasteByReader = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = tasteByReader.get(row.readerId) ?? new Set<string>();
    set.add(row.tasteVersion);
    tasteByReader.set(row.readerId, set);
  }
  const readerTasteChanged = [...tasteByReader.values()].some((set) => set.size > 1);
  const spread = rows.length > 0 ? Math.max(...rows.map((r) => r.stars)) - Math.min(...rows.map((r) => r.stars)) : 0;
  const notes: string[] = [];

  if (rows.length < 2) {
    return { attribution: "incomparable", rows, spread, notes: ["至少需要两条评分才能比较"] };
  }

  let attribution: ComparisonAttribution;
  if (readerCount > 1 && revisionCount === 1) {
    attribution = "taste_difference";
    notes.push("同一章、同一稿件版本、不同读者：分差来自口味差异");
  } else if (readerCount === 1 && revisionCount > 1) {
    if (readerTasteChanged) {
      attribution = "mixed_change";
      notes.push("同一读者、不同稿件版本，但口味版本也变了：标为混合变化，不能单独归因");
    } else {
      attribution = "manuscript_change";
      notes.push("同一读者、同一口味版本、不同稿件版本：分差来自稿件变化");
    }
  } else if (readerCount > 1 && revisionCount > 1) {
    attribution = "mixed_change";
    notes.push("读者与稿件都变了：标为混合变化，不能单独归因");
  } else {
    attribution = "incomparable";
    notes.push("同一读者、同一版本只有一条评分，没有可比对象");
  }

  if (spread >= 2) {
    notes.push(`星级极差 ${spread} 星，属于明显分歧，值得看两边段评`);
  }
  return { attribution, rows, spread, notes };
}
