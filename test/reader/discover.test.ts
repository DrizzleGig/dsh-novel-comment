import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TAG_CATEGORIES,
  canonicalTag,
  normalizeTags,
  tagOverlap,
  rankCandidates,
  planNewBookSlots,
  distillCommentEvidence,
  commentStyleHints,
  FakeSource,
  SourceStopError,
} from "../../src/reader/index.ts";
import type { QuotaUsage } from "../../src/core/index.ts";

const EMPTY: QuotaUsage = { newBooks: 0, chapters: 0, words: 0, tokens: 0, unknownTokens: 0 };

/* --------------------------------- 标签 --------------------------------- */

test("标签：覆盖作者点名的系统流/多女主/单女主/后宫/穿越", () => {
  const all = TAG_CATEGORIES.flatMap((c) => c.tags);
  for (const tag of ["系统流", "多女主", "单女主", "后宫", "穿越"]) {
    assert.ok(all.includes(tag), `标签库缺少 ${tag}`);
  }
});

test("标签：别名映射到规范标签，对不上的进 unknown", () => {
  assert.equal(canonicalTag("末日"), "末世");
  assert.equal(canonicalTag("系统文"), "系统流");
  assert.equal(canonicalTag("随便编的"), null);
  const normalized = normalizeTags(["系统文", "1v1", "未知标签"]);
  assert.deepEqual(normalized.known, ["单女主", "系统流"]);
  assert.deepEqual(normalized.unknown, ["未知标签"]);
  assert.equal(normalized.aliased["系统文"], "系统流");
});

test("标签：Jaccard 相似度", () => {
  assert.equal(tagOverlap(["a", "b"], ["a", "b"]), 1);
  assert.equal(tagOverlap(["a"], ["b"]), 0);
  assert.equal(tagOverlap([], []), 0);
});

/* --------------------------------- 找书 --------------------------------- */

const CANDIDATES = [
  { bookId: "b1", title: "系统书一", author: "老K", tags: ["系统流", "快节奏"] },
  { bookId: "b2", title: "系统书二", author: "老K", tags: ["系统流", "快节奏"] },
  { bookId: "b3", title: "情感书", author: "南枝", tags: ["单女主", "慢热"] },
  { bookId: "b4", title: "后宫书", author: "青衫", tags: ["后宫", "多女主"] },
];

test("找书：雷点硬过滤、同作者降权、排除已读", () => {
  const picks = rankCandidates(
    {
      likedTags: [
        { tagId: "系统流", weight: 0.9 },
        { tagId: "单女主", weight: 0.6 },
      ],
      dislikedTags: [{ tagId: "后宫", weight: 1 }],
    },
    CANDIDATES,
    { excludeBookIds: ["b2"], limit: 2 },
  );
  assert.ok(picks.every((p) => !p.hitDislikedTags.includes("后宫")));
  assert.ok(picks.every((p) => p.book.bookId !== "b2"));
  // b1 和 b3 作者不同；同作者的 b2 已排除
  assert.equal(new Set(picks.map((p) => p.book.author)).size, picks.length);
  assert.equal(picks[0]!.book.bookId, "b1");
});

test("找书：没有候选时返回空，不硬凑", () => {
  const picks = rankCandidates({ likedTags: [], dislikedTags: [] }, [], { limit: 3 });
  assert.deepEqual(picks, []);
});

/* -------------------------------- 调度 ---------------------------------- */

const LIMITS = { newBooks: 2, chapters: 20, words: 60_000, tokens: 120_000 };
const READER_LIMITS = { newBooks: 1, chapters: 5, words: 15_000, tokens: 30_000 };

test("调度：自动模式在峰时挂起，手动可跑但仍受上限", () => {
  const peak = new Date("2026-11-25T02:30:00Z"); // 北京时间周三 10:30
  const auto = planNewBookSlots({
    now: peak,
    tzOffsetMinutes: 480,
    mode: "auto",
    limits: LIMITS,
    usage: EMPTY,
    readerLimit: READER_LIMITS,
    readers: [{ readerId: "r1" }],
  });
  assert.equal(auto.allowed, false);
  assert.match(auto.reason ?? "", /高峰/);

  const manual = planNewBookSlots({
    now: peak,
    tzOffsetMinutes: 480,
    mode: "manual",
    limits: LIMITS,
    usage: EMPTY,
    readerLimit: READER_LIMITS,
    readers: [{ readerId: "r1" }],
  });
  assert.equal(manual.allowed, true);
  assert.equal(manual.slots.length, 1);
});

test("调度：全局上限截断，跨读者按上次调度轮转（没被调度过的优先）", () => {
  const valley = new Date("2026-11-27T12:00:00Z"); // 北京时间 20:00
  const decision = planNewBookSlots({
    now: valley,
    tzOffsetMinutes: 480,
    mode: "auto",
    limits: { ...LIMITS, newBooks: 2 },
    usage: { ...EMPTY, newBooks: 1 },
    readerLimit: READER_LIMITS,
    readers: [
      { readerId: "r-new", lastServedAt: undefined },
      { readerId: "r-old", lastServedAt: "2026-11-20T00:00:00.000Z" },
    ],
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.remainingByDimension.newBooks, 1);
  assert.deepEqual(decision.slots.map((s) => s.readerId), ["r-new"]);
});

test("调度：到上限直接拒绝", () => {
  const decision = planNewBookSlots({
    now: new Date("2026-11-27T12:00:00Z"),
    tzOffsetMinutes: 480,
    mode: "manual",
    limits: LIMITS,
    usage: { ...EMPTY, newBooks: 2 },
    readerLimit: READER_LIMITS,
    readers: [{ readerId: "r1" }],
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /配额已用完/);
});

test("调度：某读者个人维度耗尽时跳过该读者", () => {
  const decision = planNewBookSlots({
    now: new Date("2026-11-27T12:00:00Z"),
    tzOffsetMinutes: 480,
    mode: "auto",
    limits: LIMITS,
    usage: EMPTY,
    readerLimit: READER_LIMITS,
    readers: [{ readerId: "r1", usage: { ...EMPTY, tokens: READER_LIMITS.tokens } }],
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.slots.length, 0);
});

test("调度：章节/字数/token 任一耗尽都不再开新任务", () => {
  for (const dimension of ["chapters", "words", "tokens"] as const) {
    const decision = planNewBookSlots({
      now: new Date("2026-11-27T12:00:00Z"),
      tzOffsetMinutes: 480,
      mode: "manual",
      limits: LIMITS,
      usage: { ...EMPTY, [dimension]: LIMITS[dimension] },
      readerLimit: READER_LIMITS,
      readers: [{ readerId: "r1" }],
    });
    assert.equal(decision.allowed, false, `${dimension} 耗尽时不应再放行`);
    assert.equal(decision.remainingByDimension[dimension], 0);
  }
});

/* ------------------------------- 评论区 -------------------------------- */

const COMMENTS = [
  { text: "这段太爽了，主角终于打脸回去", likes: 12, paragraphIndex: 1 },
  { text: "笑死，这个配角好惨", likes: 8, paragraphIndex: 2 },
  { text: "节奏有点拖，作者水了一章", likes: 3 },
  { text: "伏笔好像埋在这里，逻辑在线", likes: 6, paragraphIndex: 0 },
];

test("评论区：产出关注点分布与语气提示，不出现任何评论原文", () => {
  const evidence = distillCommentEvidence(COMMENTS);
  assert.equal(evidence.available, true);
  assert.equal(evidence.sampled, 4);
  assert.equal(evidence.paragraphCommentRatio, 0.75);
  assert.ok(evidence.concerns.some((c) => c.label === "爽点"));
  assert.ok(evidence.concerns.some((c) => c.label === "节奏"));
  const serialized = JSON.stringify(evidence) + JSON.stringify(commentStyleHints(evidence));
  for (const comment of COMMENTS) {
    assert.ok(!serialized.includes(comment.text), "输出里不能出现评论原文");
  }
  assert.ok(commentStyleHints(evidence).length > 0);
});

test("评论区：没有评论时明确标不可用", () => {
  const evidence = distillCommentEvidence([]);
  assert.equal(evidence.available, false);
  assert.deepEqual(commentStyleHints(evidence), []);
});

/* -------------------------------- 假书源 -------------------------------- */

test("假书源：按标签搜索、读章、读评论；付费墙/结构变化抛停止原因", async () => {
  const source = new FakeSource();
  const results = await source.search({ tags: ["系统流"] });
  assert.ok(results.length >= 1);
  assert.ok(results.every((r) => r.book.tags.includes("系统流")));

  const chapter = await source.fetchChapter("fake-sys-1", "c1");
  assert.equal(chapter.sequenceNumber, 1);
  assert.match(chapter.title, /签到/);

  await assert.rejects(
    () => source.fetchChapter("fake-sys-1", "c3"),
    (error: unknown) => error instanceof SourceStopError && error.reason === "layout_changed",
  );
  await assert.rejects(
    () => source.fetchChapter("fake-sys-1", "c999"),
    (error: unknown) => error instanceof SourceStopError && error.reason === "paywall",
  );

  const comments = await source.fetchComments("fake-sys-1", "c1");
  assert.ok(comments.length > 0);
});
