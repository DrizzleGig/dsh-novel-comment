import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ReaderStore, assertSafeId } from "../../src/reader/store.ts";
import { parseReview, buildReviewRequest } from "../../src/reader/review.ts";
import type { ChapterReview } from "../../src/core/index.ts";

async function withStore(fn: (store: ReaderStore, root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "reader-"));
  try {
    await fn(new ReaderStore(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function sampleReview(): ChapterReview {
  return {
    id: "ch01--binge",
    chapterId: "ch01",
    profileId: "binge",
    scores: { 节奏: 8 },
    findings: [{ id: "ch01-1", kind: "experience", excerpt: "雨夜", note: "开头有画面" }],
    createdAt: new Date().toISOString(),
  };
}

test("写入后能读回同一条评审", async () => {
  await withStore(async (store) => {
    const review = sampleReview();
    await store.writeReview(review);
    const back = await store.readReview("ch01", "binge");
    assert.deepEqual(back?.scores, { 节奏: 8 });
    assert.equal(back?.findings.length, 1);
  });
});

test("未写入时读取返回 null", async () => {
  await withStore(async (store) => {
    assert.equal(await store.readReview("nope", "binge"), null);
  });
});

test("默认读取三种预置读者", async () => {
  await withStore(async (store) => {
    const profiles = await store.readProfiles();
    assert.equal(profiles.length, 3);
    assert.deepEqual(
      profiles.map((p) => p.id),
      ["binge", "emotion", "plot"],
    );
  });
});

test("非法 id 被拒绝（路径穿越）", () => {
  assert.throws(() => assertSafeId("../../etc", "chapterId"));
  assert.throws(() => assertSafeId("a/b"));
  assert.doesNotThrow(() => assertSafeId("ch_01-abc"));
});

test("写入时拒绝非法 chapterId", async () => {
  await withStore(async (store) => {
    const review = { ...sampleReview(), chapterId: "../evil" };
    await assert.rejects(() => store.writeReview(review));
  });
});

test("损坏的评审文件被跳过，不影响其它记录", async () => {
  await withStore(async (store, root) => {
    await store.writeReview(sampleReview());
    const dir = path.join(root, ".dsh-novel-comment", "reviews");
    await writeFile(path.join(dir, "broken--x.json"), "{not json", "utf8");
    const all = await store.listReviews();
    assert.equal(all.length, 1);
    assert.equal(all[0].chapterId, "ch01");
  });
});

test("parseReview 能从 markdown 包裹里提取并裁剪分数", () => {
  const raw = '好的：\n```json\n{"scores":{"节奏":12,"人物":-3},"findings":[{"kind":"unknown","excerpt":"x","note":"y"}]}\n```';
  const review = parseReview(raw, "ch02", "plot");
  assert.equal(review.scores["节奏"], 10);
  assert.equal(review.scores["人物"], 0);
  assert.equal(review.findings[0].kind, "experience");
});

test("parseReview 对缺 scores 的响应报错", () => {
  assert.throws(() => parseReview('{"findings":[]}', "ch03", "binge"));
});

test("buildReviewRequest 不包含作者后文，只包含读者记忆", () => {
  const req = buildReviewRequest({
    profile: {
      id: "binge",
      name: "追更读者",
      kind: "binge",
      preferences: ["节奏快"],
      dislikes: ["拖沓"],
      readUpTo: null,
    },
    chapterId: "ch05",
    text: "本章正文",
    memory: ["第 1 章：主角离家"],
  });
  assert.match(req.system, /只能基于这些/);
  assert.match(req.user, /本章正文/);
  assert.doesNotMatch(req.user, /第 6 章/);
});
