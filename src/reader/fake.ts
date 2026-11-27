import type { ChapterRating, ReaderAgent, SegmentComment, StarRating, TasteProfile } from "../core/index.ts";
import { buildRating } from "./rating.ts";
import { splitParagraphs } from "./locate.ts";

export interface FakeReviewInput {
  reader: ReaderAgent;
  taste: TasteProfile;
  bookId: string;
  chapterId: string;
  revision: number;
  contentHash: string;
  title: string;
  content: string;
  now?: string;
}

/**
 * 确定性模拟读者：不调模型、不联网。
 * 同样输入永远得到同样结果，用来跑端到端与 UI 演示；结果必须标 simulated。
 */
export function fakeReview(input: FakeReviewInput): ChapterRating {
  const paragraphs = splitParagraphs(input.content);
  const seed = hash32(`${input.reader.id}|${input.bookId}|${input.chapterId}|${input.revision}|${input.contentHash}`);
  const stars = (1 + (seed % 5)) as StarRating;
  const first = paragraphs[0] ?? "";
  const quote = [...first].slice(0, 24).join("");
  const segmentComments: SegmentComment[] =
    quote.length > 0
      ? [
          {
            locator: { paragraphIndex: 0, quote, prefix: "", suffix: "" },
            excerpt: quote,
            comment: stars >= 4 ? "这段有画面，愿意往下看。" : "这段信息量偏低，容易走神。",
          },
        ]
      : [];
  const status = stars >= 4 ? "follow" : stars === 3 ? "watch" : "drop";
  return buildRating({
    readerId: input.reader.id,
    target: {
      kind: "manuscript",
      bookId: input.bookId,
      chapterId: input.chapterId,
      contentHash: input.contentHash,
      chapterNumber: 1,
      revision: input.revision,
    },
    stars,
    chapterComment: `（模拟）${stars >= 4 ? "这一章有钩子，想知道后面怎么走。" : stars === 3 ? "能看，但还没抓住我。" : "节奏和人物都没立住，我会弃。"}`,
    segmentComments,
    status,
    dropReasonCode: status === "drop" ? "slow_pacing" : undefined,
    tasteVersion: input.taste.version,
    model: "fake-reader",
    promptVersion: "fake-v1",
    usage: { inputTokens: null, outputTokens: null, source: "unknown" },
    now: input.now,
  });
}

function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
