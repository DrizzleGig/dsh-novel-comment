import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReaderAgent, TasteProfile } from "../../src/core/index.ts";
import {
  advanceReviewMemory,
  buildReviewPrompt,
  generateReview,
  mergeReviewMemory,
  parseReviewDraft,
  ReviewModelError,
  emptyReadingMemory,
} from "../../src/reader/index.ts";
import type { ReviewModelPort, ReviewModelRequest, ReviewModelResponse, ReviewPromptInput } from "../../src/reader/index.ts";

const CONTENT = `雨从傍晚开始下，一直没有停。

巷口的灯坏了三个月，没人来修。沈砚站在屋檐下，听见身后有人踩水走近。`;

const READER: ReaderAgent = {
  schemaVersion: 2,
  id: "r-binge",
  name: "追更的阿追",
  status: "active",
  persona: "只想快点知道后面发生什么",
  revision: 1,
  tasteVersion: "t1",
  createdAt: "2026-11-27T00:00:00.000Z",
};

const TASTE: TasteProfile = {
  schemaVersion: 2,
  readerId: READER.id,
  version: "t1",
  parentVersion: null,
  likedTags: [{ tagId: "快节奏", weight: 0.9 }],
  dislikedTags: [],
  likedAuthors: [],
  dislikedAuthors: [],
  likedTropes: [],
  dislikedTropes: [],
  pacingTolerance: [],
  sensitivities: { prose: [], dialogue: [], setting: [] },
  commentStyle: ["直白"],
  evidenceRatingIds: [],
  updatedAt: "2026-11-27T00:00:00.000Z",
};

const INPUT: ReviewPromptInput = {
  reader: READER,
  taste: TASTE,
  reviewMemory: null,
  bookId: "b",
  chapterId: "c1",
  chapterNumber: 1,
  title: "第一章",
  content: CONTENT,
};

function validJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    stars: 4,
    chapterComment: "钩子立住了，但人物还有点薄。",
    status: "follow",
    segments: [
      {
        quote: "雨从傍晚开始下",
        prefix: "",
        suffix: "",
        paragraphIndex: 0,
        comment: "开篇画面好",
      },
    ],
    memory: {
      characters: [{ name: "沈砚", belief: "好像在等人", confidence: "inferred" }],
      expectations: ["想知道她在等谁"],
      emotionalTone: "压抑",
      unreadQuestions: ["窗台的花是谁放的"],
    },
    ...overrides,
  });
}

class ScriptedPort implements ReviewModelPort {
  readonly id = "scripted";
  readonly model = "scripted-1";
  calls = 0;
  private readonly outputs: string[];

  constructor(outputs: string[]) {
    this.outputs = [...outputs];
  }

  async generate(_request: ReviewModelRequest): Promise<ReviewModelResponse> {
    this.calls++;
    const text = this.outputs.length > 1 ? this.outputs.shift()! : this.outputs[0]!;
    return { text, model: this.model, usage: { inputTokens: 100, outputTokens: 50, source: "provider" } };
  }
}

test("提示词：只含本章与前驱记忆，不含后文标记", () => {
  const request = buildReviewPrompt(INPUT);
  const joined = request.messages.map((m) => m.content).join("\n");
  assert.match(joined, /第 1 章 · 第一章/);
  assert.match(joined, /第一章，你对之前一无所知/);
  assert.doesNotMatch(joined, /第 2 章/);
  assert.equal(request.messages[0]!.role, "system");
});

test("解析：合规输出得到评分草稿与记忆", () => {
  const draft = parseReviewDraft(validJson(), INPUT);
  assert.equal(draft.stars, 4);
  assert.equal(draft.segmentComments.length, 1);
  assert.equal(draft.memory.characters[0]!.name, "沈砚");
});

test("解析：星级越界/段评引用不在正文/缺 memory 都拒绝", () => {
  assert.throws(() => parseReviewDraft(validJson({ stars: 9 }), INPUT), ReviewModelError);
  assert.throws(
    () =>
      parseReviewDraft(
        validJson({
          segments: [{ quote: "这句话正文里没有", prefix: "", suffix: "", paragraphIndex: 0, comment: "x" }],
        }),
        INPUT,
      ),
    /无法在正文定位/,
  );
  assert.throws(() => parseReviewDraft(validJson({ memory: undefined }), INPUT), /缺少 memory/);
});

test("生成：第一次不合规时自动修复一次", async () => {
  const port = new ScriptedPort([validJson({ stars: 9 }), validJson()]);
  const result = await generateReview(port, INPUT);
  assert.equal(result.repaired, true);
  assert.equal(port.calls, 2);
  assert.equal(result.draft.stars, 4);
});

test("生成：两次都不合规就失败（不 clamp、不伪造）", async () => {
  const port = new ScriptedPort([validJson({ stars: 0 }), validJson({ stars: 7 })]);
  await assert.rejects(() => generateReview(port, INPUT), /两次都不合规/);
  assert.equal(port.calls, 2);
});

test("记忆：合并后进度/疲劳/drop 原因正确，评审链推进", () => {
  const draft = parseReviewDraft(validJson({ status: "drop", dropReasonCode: "slow_pacing", stars: 2 }), INPUT);
  const merged = mergeReviewMemory(emptyReadingMemory(READER.id, "b"), draft, { bookId: "b", sequenceNumber: 1 }, "2026-11-27T01:00:00.000Z");
  assert.equal(merged.readThrough, 1);
  assert.equal(merged.fatigueCounter, 1);
  assert.equal(merged.droppedReason, "slow_pacing");

  const review = advanceReviewMemory(null, draft, { bookId: "b", readerId: READER.id, chapterNumber: 1 }, "2026-11-27T01:00:00.000Z");
  assert.equal(review.validThrough, 1);
  assert.equal(review.generation, 1);
  assert.match(review.entries[0]!.memory, /星级 2/);
});
