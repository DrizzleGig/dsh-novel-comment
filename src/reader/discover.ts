import type { TasteTagWeight } from "../core/index.ts";
import { tagOverlap } from "./tags.ts";

export interface CandidateBook {
  bookId: string;
  title: string;
  author?: string;
  tags: string[];
  summary?: string;
  sourceId?: string;
  sourceSite?: string;
}

export interface DiscoverTaste {
  likedTags: TasteTagWeight[];
  dislikedTags: TasteTagWeight[];
  likedAuthors?: string[];
  dislikedAuthors?: string[];
}

export interface RankOptions {
  /** 已读/已弃，直接排除 */
  excludeBookIds?: string[];
  excludeAuthors?: string[];
  limit?: number;
  /** 作者重复降权（默认 0.35） */
  sameAuthorPenalty?: number;
  /** 标签相似度降权（默认 0.5） */
  similarTagPenalty?: number;
}

export interface DiscoveredBook {
  book: CandidateBook;
  score: number;
  matchedTags: string[];
  hitDislikedTags: string[];
  reason: string;
}

/**
 * 按读者口味给候选书打分：
 *  - 必选标签（liked）加权加分；disliked 命中直接大幅扣分；
 *  - 同作者、标签高度相似的书降权，保证一轮里挑出来的书有区分度；
 *  - 分数只用于排序，不假装是「质量分」。
 */
export function rankCandidates(taste: DiscoverTaste, candidates: CandidateBook[], options: RankOptions = {}): DiscoveredBook[] {
  const excludeIds = new Set(options.excludeBookIds ?? []);
  const excludeAuthors = new Set((options.excludeAuthors ?? []).map((a) => a.trim()).filter(Boolean));
  const liked = new Map(taste.likedTags.map((t) => [t.tagId, t.weight]));
  const disliked = new Map(taste.dislikedTags.map((t) => [t.tagId, t.weight]));
  const likedAuthors = new Set(taste.likedAuthors ?? []);
  const dislikedAuthors = new Set(taste.dislikedAuthors ?? []);

  const scored: DiscoveredBook[] = candidates
    .filter((book) => !excludeIds.has(book.bookId))
    .filter((book) => !book.author || !excludeAuthors.has(book.author))
    .map((book) => {
      let score = 0;
      const matchedTags: string[] = [];
      const hitDislikedTags: string[] = [];
      for (const tag of book.tags) {
        const likeWeight = liked.get(tag);
        if (likeWeight !== undefined) {
          score += likeWeight;
          matchedTags.push(tag);
        }
        const dislikeWeight = disliked.get(tag);
        if (dislikeWeight !== undefined) {
          score -= dislikeWeight * 2;
          hitDislikedTags.push(tag);
        }
      }
      if (book.author && likedAuthors.has(book.author)) score += 0.5;
      if (book.author && dislikedAuthors.has(book.author)) score -= 1;
      return { book, score, matchedTags, hitDislikedTags, reason: "" };
    })
    // 排除标签是硬过滤：命中就出局，喜欢标签不能抵消
    .filter((item) => item.hitDislikedTags.length === 0)
    .sort((a, b) => b.score - a.score || a.book.bookId.localeCompare(b.book.bookId));

  // 贪心挑选：已选中的作者/标签越像，后面的书扣得越多
  const picked: DiscoveredBook[] = [];
  const pool = [...scored];
  const sameAuthorPenalty = options.sameAuthorPenalty ?? 0.35;
  const similarTagPenalty = options.similarTagPenalty ?? 0.5;
  while (pool.length > 0 && picked.length < (options.limit ?? 3)) {
    let bestIndex = 0;
    let bestAdjusted = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i]!;
      let adjusted = item.score;
      for (const chosen of picked) {
        if (item.book.author && chosen.book.author && item.book.author === chosen.book.author) adjusted -= sameAuthorPenalty;
        adjusted -= similarTagPenalty * tagOverlap(item.book.tags, chosen.book.tags);
      }
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIndex = i;
      }
    }
    const [chosen] = pool.splice(bestIndex, 1);
    if (!chosen) break;
    picked.push({ ...chosen, reason: describe(chosen) });
  }
  return picked;
}

function describe(item: DiscoveredBook): string {
  const parts: string[] = [];
  if (item.matchedTags.length > 0) parts.push(`对口味：${item.matchedTags.join("、")}`);
  if (item.hitDislikedTags.length > 0) parts.push(`含雷点：${item.hitDislikedTags.join("、")}`);
  return parts.join("；") || "标签一般，先试读";
}
