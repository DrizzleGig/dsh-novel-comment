import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ReaderService } from "../../src/adapter/service.ts";
import type { ReviewModelPort, ReviewModelRequest, ReviewModelResponse } from "../../src/reader/index.ts";

const CLOCK = () => new Date("2026-11-27T12:00:00Z");
const CONTENT = "雨从傍晚开始下，一直没有停。\n\n巷口的灯坏了三个月，没人来修。沈砚站在屋檐下。";

function reviewJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    stars: 4,
    chapterComment: "钩子立住了，人物还薄一点。",
    status: "follow",
    segments: [{ quote: "雨从傍晚开始下", prefix: "", suffix: "", paragraphIndex: 0, comment: "开篇画面好" }],
    memory: {
      characters: [{ name: "沈砚", belief: "在屋檐下等人", confidence: "observed" }],
      expectations: ["想知道她在等谁"],
      emotionalTone: "压抑",
      unreadQuestions: ["巷口的灯为什么坏了三个月没人修"],
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
    return { text, model: this.model, usage: { inputTokens: 120, outputTokens: 60, source: "provider" } };
  }
}

async function withService(
  port: ReviewModelPort,
  fn: (service: ReaderService, root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "reader-review-"));
  try {
    const service = await new ReaderService(root, { clock: CLOCK, reviewPort: port }).init();
    await fn(service, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("真实评审：模型输出 → 评分 + 阅读记忆 + 评审链 + 配额一次提交", async () => {
  const port = new ScriptedPort([reviewJson()]);
  await withService(port, async (service) => {
    const reader = await service.createReaderFromTemplate("binge");
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "一", content: CONTENT });
    await service.importChapter({ bookId: "b", chapterId: "c2", sequenceNumber: 2, title: "二", content: CONTENT });

    const result = await service.reviewChapter({ readerId: reader.id, bookId: "b", chapterId: "c1" });
    assert.equal(result.rating.stars, 4);
    assert.equal(result.reviewMemory.validThrough, 1);
    assert.equal(result.memory.readThrough, 1);
    assert.equal(result.usage.global.chapters, 1);
    assert.equal(result.usage.global.tokens, 180);
    assert.equal((await service.listRatings({ readerId: reader.id })).length, 1);

    const second = await service.reviewChapter({ readerId: reader.id, bookId: "b", chapterId: "c2" });
    assert.equal(second.reviewMemory.validThrough, 2);
    assert.equal(second.usage.global.chapters, 2);
  });
});

test("真实评审：第 2 章没有第 1 章记忆时拒绝，模型不被调用", async () => {
  const port = new ScriptedPort([reviewJson()]);
  await withService(port, async (service) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c2", sequenceNumber: 2, title: "二", content: CONTENT });
    await assert.rejects(() => service.reviewChapter({ readerId: reader.id, bookId: "b", chapterId: "c2" }), /不能直接评审第 2 章/);
    assert.equal(port.calls, 0);
  });
});

test("真实评审：输出不合规自动修复一次，repaired=true", async () => {
  const port = new ScriptedPort([reviewJson({ stars: 9 }), reviewJson()]);
  await withService(port, async (service) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "一", content: CONTENT });
    const result = await service.reviewChapter({ readerId: reader.id, bookId: "b", chapterId: "c1" });
    assert.equal(result.repaired, true);
    assert.equal(port.calls, 2);
  });
});

test("真实评审：两次都不合规就失败，不落评分", async () => {
  const port = new ScriptedPort([reviewJson({ stars: 9 }), reviewJson({ stars: 0 })]);
  await withService(port, async (service) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "一", content: CONTENT });
    await assert.rejects(() => service.reviewChapter({ readerId: reader.id, bookId: "b", chapterId: "c1" }), /两次都不合规/);
    assert.equal((await service.listRatings({ readerId: reader.id })).length, 0);
    assert.equal(await service.getReviewMemory(reader.id, "b"), null);
  });
});

test("真实评审：同 requestId 不重复调用模型", async () => {
  const port = new ScriptedPort([reviewJson()]);
  await withService(port, async (service) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "一", content: CONTENT });
    const first = await service.reviewChapter({ readerId: reader.id, bookId: "b", chapterId: "c1", requestId: "req-review-1" });
    const again = await service.reviewChapter({ readerId: reader.id, bookId: "b", chapterId: "c1", requestId: "req-review-1" });
    assert.equal(port.calls, 1);
    assert.equal(again.rating.id, first.rating.id);
  });
});
