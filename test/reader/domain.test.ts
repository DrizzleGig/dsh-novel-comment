import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertCanCreateReader,
  resolveReaderLimits,
  checkQuota,
  addUsage,
  emptyUsage,
  createInitialTaste,
  updateTaste,
  buildRating,
  validateStars,
  RatingValidationError,
  locateAnchor,
  buildLocator,
  splitParagraphs,
  classifyMoment,
  canAutoRunAt,
  assertNextReadingChapter,
  assertReviewOrder,
  measureMemory,
  nextFatigue,
  shouldDrop,
  compareRatings,
  renderDailyReport,
  ReadingOrderError,
  sha256Hex,
} from "../../src/reader/index.ts";
import type { ReviewMemory } from "../../src/core/index.ts";

/* ------------------------------- 读者上限 ------------------------------- */

test("读者上限：超过配置上限拒绝创建", () => {
  const limits = resolveReaderLimits(2, { maxReaders: 8, hardMaxReaders: 16 });
  assert.equal(limits.maxReaders, 2);
  assert.doesNotThrow(() => assertCanCreateReader(1, limits));
  assert.throws(() => assertCanCreateReader(2, limits), /已达上限/);
});

test("读者上限：配置超过硬上限时取硬上限", () => {
  const limits = resolveReaderLimits(99, { maxReaders: 8, hardMaxReaders: 16 });
  assert.equal(limits.maxReaders, 16);
});

test("读者上限：非法配置直接报错，不静默改默认", () => {
  assert.throws(() => resolveReaderLimits(0, { maxReaders: 8, hardMaxReaders: 16 }));
  assert.throws(() => resolveReaderLimits(Number.NaN, { maxReaders: 8, hardMaxReaders: 16 }));
});

/* --------------------------------- 配额 --------------------------------- */

test("配额：任一维度到顶就拒绝", () => {
  const limits = { newBooks: 2, chapters: 5, words: 1000, tokens: 100 };
  const usage = { ...emptyUsage(), newBooks: 2 };
  const check = checkQuota(limits, usage, { newBooks: 1 });
  assert.equal(check.ok, false);
  assert.equal(check.exceeded, "newBooks");
});

test("配额：未知 token 单独计数，不记 0", () => {
  const usage = addUsage(emptyUsage(), { chapters: 1, tokens: null });
  assert.equal(usage.chapters, 1);
  assert.equal(usage.tokens, 0);
  assert.equal(usage.unknownTokens, 1);
});

/* --------------------------------- 口味 --------------------------------- */

test("口味：内容不变不产生新版本", () => {
  const taste = createInitialTaste({ readerId: "r1", likedTags: [{ tagId: "系统流", weight: 0.8 }] });
  const same = updateTaste(taste, { likedTags: [{ tagId: "系统流", weight: 0.8 }] });
  assert.equal(same.version, taste.version);
});

test("口味：改动产生新版本且父版本指向旧版", () => {
  const taste = createInitialTaste({ readerId: "r1" });
  const next = updateTaste(taste, { dislikedTags: [{ tagId: "后宫", weight: 0.9 }] }, ["rating-1"]);
  assert.notEqual(next.version, taste.version);
  assert.equal(next.parentVersion, taste.version);
  assert.deepEqual(next.evidenceRatingIds, ["rating-1"]);
});

/* --------------------------------- 评分 --------------------------------- */

test("评分：只接受 1–5 整数，不 clamp", () => {
  assert.equal(validateStars(5), 5);
  for (const bad of [0, 6, 3.5, "4", null, Number.NaN]) {
    assert.throws(() => validateStars(bad), RatingValidationError, `应拒绝 ${String(bad)}`);
  }
});

test("评分：弃书必须给原因码", () => {
  assert.throws(
    () =>
      buildRating({
        readerId: "r1",
        target: { kind: "manuscript", bookId: "b1", chapterId: "c1", contentHash: "h", chapterNumber: 1, revision: 1 },
        stars: 2,
        chapterComment: "看不下去",
        status: "drop",
        tasteVersion: "t1",
        model: "m",
        promptVersion: "p",
      }),
    /弃书必须给出原因码/,
  );
});

test("评分：章评超长直接拒绝", () => {
  assert.throws(
    () =>
      buildRating({
        readerId: "r1",
        target: { kind: "manuscript", bookId: "b1", chapterId: "c1", contentHash: "h", chapterNumber: 1, revision: 1 },
        stars: 3,
        chapterComment: "字".repeat(201),
        status: "watch",
        tasteVersion: "t1",
        model: "m",
        promptVersion: "p",
      }),
    /超过 200 字/,
  );
});

/* --------------------------------- 定位 --------------------------------- */

const CHAPTER = `雨从傍晚开始下，一直没有停。

巷口的灯坏了三个月，没人来修。沈砚站在屋檐下，听见身后有人踩水走近。`;

test("定位：精确匹配", () => {
  const loc = locateAnchor(CHAPTER, { paragraphIndex: 1, quote: "沈砚站在屋檐下", prefix: "没人来修。", suffix: "" });
  assert.equal(loc.match, "exact");
  assert.equal(loc.paragraphIndex, 1);
  assert.ok(loc.start !== null && loc.start >= 0);
});

test("定位：在章首插入 20 字后仍然能找到原句（不偏移）", () => {
  const locator = buildLocator(CHAPTER, 1, 0, 12)!;
  const shifted = `作者新加的二十个字开场白在这里。\n\n${CHAPTER}`;
  // 段落序号整体后移一位，但引用本身仍应精确定位
  const loc = locateAnchor(shifted, { ...locator, paragraphIndex: locator.paragraphIndex + 1 });
  assert.equal(loc.match, "exact");
});

test("定位：同段重复引用 → ambiguous，不猜位置", () => {
  const text = `他说好。她说好。`;
  const loc = locateAnchor(text, { paragraphIndex: 0, quote: "好", prefix: "", suffix: "" });
  assert.equal(loc.match, "ambiguous");
  assert.equal(loc.start, null);
});

test("定位：引用不在原文 → unmatched（不做模糊凑匹配）", () => {
  const loc = locateAnchor(CHAPTER, { paragraphIndex: 1, quote: "沈砚站在屋檐下，笑了笑", prefix: "", suffix: "" });
  assert.equal(loc.match, "unmatched");
});

test("定位：标点改动导致 quote 不存在时不得通过（只做 NFC/空白）", () => {
  const loc = locateAnchor(CHAPTER, { paragraphIndex: 1, quote: "巷口的灯坏了三个月没人来修", prefix: "", suffix: "" });
  assert.equal(loc.match, "unmatched");
});

test("分段：空行分段协议", () => {
  assert.equal(splitParagraphs(CHAPTER).length, 2);
});

/* --------------------------------- 谷时 --------------------------------- */

test("谷时：工作日 9–12/14–18 是峰，其余是谷", () => {
  assert.equal(classifyMoment({ weekday: 3, hour: 10, minute: 0 }), "peak");
  assert.equal(classifyMoment({ weekday: 3, hour: 13, minute: 0 }), "valley");
  assert.equal(classifyMoment({ weekday: 3, hour: 20, minute: 0 }), "valley");
  assert.equal(classifyMoment({ weekday: 6, hour: 10, minute: 0 }), "valley");
});

test("谷时：非谷时自动任务被挂起，手动可显式绕过（由调用方决定）", () => {
  const peakMoment = new Date("2026-11-25T02:30:00Z"); // 北京时间 10:30 周三
  const result = canAutoRunAt(peakMoment, 480);
  assert.equal(result.allowed, false);
  assert.match(result.reason ?? "", /高峰/);
});

/* ------------------------------- 顺序与记忆 ------------------------------ */

test("顺序：外部作品必须按序读", () => {
  assert.doesNotThrow(() => assertNextReadingChapter(0, 1));
  assert.throws(() => assertNextReadingChapter(0, 2), ReadingOrderError);
  assert.doesNotThrow(() => assertNextReadingChapter(3, 4));
});

test("顺序：作者稿第 2 章没有第 1 章记忆时拒绝", () => {
  assert.throws(() => assertReviewOrder(null, 2, 1), /不能直接评审/);
});

test("顺序：评审链已换代时拒绝", () => {
  const memory: ReviewMemory = {
    schemaVersion: 2,
    id: "m",
    readerId: "r",
    bookId: "b",
    generation: 2,
    validThrough: 3,
    invalidFrom: null,
    entries: [],
    updatedAt: new Date().toISOString(),
  };
  assert.throws(() => assertReviewOrder(memory, 4, 1), /换代/);
  assert.doesNotThrow(() => assertReviewOrder(memory, 4, 2));
});

test("记忆：4 KB / 800 tokens 双上限", () => {
  const small = measureMemory({ a: "短" });
  assert.ok(small.utf8Bytes < 4096);
  const big = measureMemory("字".repeat(3000));
  assert.ok(big.utf8Bytes > 4096);
});

test("疲劳：3 星及以下累计，4–5 星归零；连续三章 ≤2 星建议弃书", () => {
  assert.equal(nextFatigue(2, 3), 3);
  assert.equal(nextFatigue(5, 4), 0);
  assert.equal(shouldDrop(0, [1, 2, 1]), true);
  assert.equal(shouldDrop(0, [4, 3, 5]), false);
});

/* --------------------------------- 分歧 --------------------------------- */

test("分歧：不同读者同版本 → 口味差异", () => {
  const result = compareRatings({
    bookId: "b",
    chapterId: "c",
    targetRevision: 1,
    items: [
      { readerId: "r1", readerName: "A", tasteVersion: "t1", stars: 5, chapterComment: "好", segmentComments: [] },
      { readerId: "r2", readerName: "B", tasteVersion: "t2", stars: 2, chapterComment: "一般", segmentComments: [] },
    ],
  });
  assert.equal(result.attribution, "taste_difference");
  assert.equal(result.spread, 3);
});

test("分歧：同读者不同稿件版本 → 稿件变化；两者都变 → 混合", () => {
  const manuscript = compareRatings({
    bookId: "b",
    chapterId: "c",
    targetRevision: 2,
    items: [
      { readerId: "r1", readerName: "A", tasteVersion: "t1", revision: 1, stars: 2, chapterComment: "改前", segmentComments: [] },
      { readerId: "r1", readerName: "A", tasteVersion: "t1", revision: 2, stars: 4, chapterComment: "改后", segmentComments: [] },
    ],
  });
  assert.equal(manuscript.attribution, "manuscript_change");
  const tasteMoved = compareRatings({
    bookId: "b",
    chapterId: "c",
    targetRevision: 2,
    items: [
      { readerId: "r1", readerName: "A", tasteVersion: "t1", revision: 1, stars: 2, chapterComment: "", segmentComments: [] },
      { readerId: "r1", readerName: "A", tasteVersion: "t2", revision: 2, stars: 4, chapterComment: "", segmentComments: [] },
    ],
  });
  assert.equal(tasteMoved.attribution, "mixed_change");
  const mixed = compareRatings({
    bookId: "b",
    chapterId: "c",
    targetRevision: 2,
    items: [
      { readerId: "r1", readerName: "A", tasteVersion: "t1", revision: 1, stars: 2, chapterComment: "", segmentComments: [] },
      { readerId: "r2", readerName: "B", tasteVersion: "t2", revision: 2, stars: 5, chapterComment: "", segmentComments: [] },
    ],
  });
  assert.equal(mixed.attribution, "mixed_change");
});

/* --------------------------------- 报告 --------------------------------- */

test("日报：每条以 ### bookId 开头，且不含正文", () => {
  const md = renderDailyReport("2026-11-27", [
    {
      bookId: "book-a",
      title: "示例书",
      readToChapter: 3,
      stars: 4,
      status: "follow",
      note: "节奏起来了",
      segmentComments: 2,
    },
  ]);
  assert.match(md, /### book-a/);
  assert.match(md, /4 星（追更）/);
  assert.doesNotMatch(md, /雨从傍晚开始下/);
});

test("哈希：稳定且 64 位十六进制", () => {
  const a = sha256Hex("abc");
  assert.equal(a, sha256Hex("abc"));
  assert.equal(a.length, 64);
  assert.equal(a.slice(0, 8), "ba7816bf");
});
