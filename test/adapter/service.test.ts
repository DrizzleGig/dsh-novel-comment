import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ReaderService } from "../../src/adapter/service.ts";
import type { ReadingMemory } from "../../src/core/index.ts";
import { emptyReadingMemory, FakeSource, fakeReview } from "../../src/reader/index.ts";
import { writeJournalRun } from "../../src/adapter/journal.ts";
import { isPrivateAddress } from "../../src/adapter/page-reader.ts";
import { planLegacyMigration, applyLegacyMigration } from "../../src/adapter/migration.ts";
import { writeJson } from "../../src/adapter/storage.ts";

async function withService(
  fn: (service: ReaderService, root: string) => Promise<void>,
  options: ConstructorParameters<typeof ReaderService>[1] = {},
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "reader-adapter-"));
  try {
    const service = await new ReaderService(root, options).init();
    await fn(service, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const CLOCK = () => new Date("2026-11-27T12:00:00Z"); // 北京时间 20:00（谷时）

test("创建读者：默认上限 8，超过配置上限拒绝", async () => {
  await withService(
    async (service) => {
      for (let i = 1; i <= 2; i++) {
        const reader = await service.createReader({ name: `读者${i}`, persona: "挑剔的追更读者" });
        assert.equal(reader.status, "active");
      }
      await assert.rejects(() => service.createReader({ name: "读者3", persona: "x" }), /已达上限/);
    },
    { limits: { maxReaders: 2 }, clock: CLOCK },
  );
});

test("读者隔离：两个读者的目录、评分、口味互不相通", async () => {
  await withService(async (service) => {
    const a = await service.createReader({ name: "甲", persona: "喜欢系统流" });
    const b = await service.createReader({ name: "乙", persona: "讨厌后宫" });
    await service.importBook({ bookId: "book-a", title: "示例书" });
    await service.importChapter({
      bookId: "book-a",
      chapterId: "ch-1",
      sequenceNumber: 1,
      title: "第一章",
      content: "雨夜。巷口的灯坏了。",
    });
    const chapter = await service.getChapter("book-a", "ch-1");
    assert.ok(chapter);
    const tasteA = await service.getTaste(a.id);
    assert.ok(tasteA);
    const rating = fakeReview({
      reader: a,
      taste: tasteA,
      bookId: "book-a",
      chapterId: "ch-1",
      revision: chapter!.revision,
      contentHash: chapter!.contentHash,
      title: "第一章",
      content: (await service.getChapterContent("book-a", "ch-1"))!,
    });
    const saved = await service.saveRating({
      readerId: a.id,
      target: rating.target,
      stars: rating.stars,
      chapterComment: rating.chapterComment,
      segmentComments: rating.segmentComments,
      status: rating.status,
      dropReasonCode: rating.dropReasonCode,
      tasteVersion: rating.tasteVersion,
      model: rating.model,
      promptVersion: rating.promptVersion,
    });
    assert.ok(saved.id.startsWith("rating-"));

    const ratingsA = await service.listRatings({ readerId: a.id });
    const ratingsB = await service.listRatings({ readerId: b.id });
    assert.equal(ratingsA.length, 1);
    assert.equal(ratingsB.length, 0);
    assert.notEqual((await service.getTaste(a.id))!.version, (await service.getTaste(b.id))!.version);
  }, { clock: CLOCK });
});

test("导入章节：内容不变不涨 revision，改了才涨", async () => {
  await withService(async (service) => {
    await service.importBook({ bookId: "b", title: "书" });
    const first = await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "第一章", content: "甲\r\n乙" });
    assert.equal(first.revision, 1);
    assert.equal(first.changed, true);
    const again = await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "第一章", content: "甲\r\n乙" });
    assert.equal(again.changed, false);
    assert.equal(again.revision, 1);
    const changed = await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "第一章", content: "甲\n乙\n丙" });
    assert.equal(changed.changed, true);
    assert.equal(changed.revision, 2);
    assert.equal(await service.getChapterContent("b", "c1", 1), "甲\n乙");
    assert.equal(await service.getChapterContent("b", "c1"), "甲\n乙\n丙");
  }, { clock: CLOCK });
});

test("评分：非法星级拒绝写入（不 clamp、不补默认）", async () => {
  await withService(async (service) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    const taste = (await service.getTaste(reader.id))!;
    await assert.rejects(
      () =>
        service.saveRating({
          readerId: reader.id,
          target: { kind: "manuscript", bookId: "b", chapterId: "c", contentHash: "h", chapterNumber: 1, revision: 1 },
          stars: 9,
          chapterComment: "x",
          status: "follow",
          tasteVersion: taste.version,
          model: "m",
          promptVersion: "p",
        }),
      /星级必须是 1–5/,
    );
    assert.equal((await service.listRatings({ readerId: reader.id })).length, 0);
  }, { clock: CLOCK });
});

test("配额：按本地日期记账，未知 token 单独计数", async () => {
  await withService(async (service) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    assert.equal(service.localDate(), "2026-11-27");
    let snapshot = await service.quota();
    assert.equal(snapshot.global.chapters, 0);
    snapshot = await service.addUsage(reader.id, { chapters: 1, words: 1200, tokens: null });
    assert.equal(snapshot.global.chapters, 1);
    assert.equal(snapshot.global.unknownTokens, 1);
    assert.equal(snapshot.readers[reader.id]!.words, 1200);
  }, { clock: CLOCK });
});

test("分歧：两个读者同章 → taste_difference，且不读取对方记忆", async () => {
  await withService(async (service) => {
    const a = await service.createReader({ name: "甲", persona: "x" });
    const b = await service.createReader({ name: "乙", persona: "y" });
    const tasteA = (await service.getTaste(a.id))!;
    const tasteB = (await service.getTaste(b.id))!;
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c", sequenceNumber: 1, title: "章", content: "正文" });
    const chapter = (await service.getChapter("b", "c"))!;
    const target = { kind: "manuscript" as const, bookId: "b", chapterId: "c", contentHash: chapter.contentHash, chapterNumber: 1, revision: chapter.revision };
    await service.saveRating({
      readerId: a.id,
      target,
      stars: 5,
      chapterComment: "好",
      status: "follow",
      tasteVersion: tasteA.version,
      model: "m",
      promptVersion: "p",
    });
    await service.saveRating({
      readerId: b.id,
      target,
      stars: 2,
      chapterComment: "一般",
      status: "watch",
      tasteVersion: tasteB.version,
      model: "m",
      promptVersion: "p",
    });
    const comparison = await service.compareChapter({ bookId: "b", chapterId: "c", revision: chapter.revision });
    assert.equal(comparison.attribution, "taste_difference");
    assert.equal(comparison.spread, 3);
    assert.equal(comparison.rows.length, 2);
  }, { clock: CLOCK });
});

test("日报：写入 reports/<date>.md", async () => {
  await withService(async (service) => {
    const file = await service.writeReport("2026-11-27", "### book-a\n");
    assert.ok(file.endsWith(path.join("reports", "2026-11-27.md")));
    assert.match((await service.readReport("2026-11-27"))!, /### book-a/);
  }, { clock: CLOCK });
});

test("按序阅读：跳章拒绝，读完后记忆与配额一起前进", async () => {
  await withService(async (service) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "一", content: "第一章正文" });
    await service.importChapter({ bookId: "b", chapterId: "c2", sequenceNumber: 2, title: "二", content: "第二章正文" });

    await assert.rejects(
      () => service.readChapter({ readerId: reader.id, bookId: "b", chapterId: "c2" }),
      /只能接着读第 1 章/,
    );

    const first = await service.readChapter({ readerId: reader.id, bookId: "b", chapterId: "c1", stars: 3, tokens: 100 });
    assert.equal(first.memory.readThrough, 1);
    assert.equal(first.memory.fatigueCounter, 1);
    assert.equal(first.usage.global.chapters, 1);

    const second = await service.readChapter({ readerId: reader.id, bookId: "b", chapterId: "c2", stars: 4 });
    assert.equal(second.memory.readThrough, 2);
    assert.equal(second.memory.fatigueCounter, 0);
    assert.equal(second.usage.global.chapters, 2);
  }, { clock: CLOCK });
});

test("日报：由当日评分自动汇总（每条 ### bookId，不附正文）", async () => {
  await withService(async (service) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    const taste = (await service.getTaste(reader.id))!;
    await service.importBook({ bookId: "book-a", title: "示例书", author: "某人" });
    await service.importChapter({ bookId: "book-a", chapterId: "c1", sequenceNumber: 1, title: "第一章", content: "雨夜正文不该出现在日报" });
    const chapter = (await service.getChapter("book-a", "c1"))!;
    await service.saveRating({
      readerId: reader.id,
      target: { kind: "manuscript", bookId: "book-a", chapterId: "c1", contentHash: chapter.contentHash, chapterNumber: 1, revision: chapter.revision },
      stars: 4,
      chapterComment: "钩子不错",
      status: "follow",
      tasteVersion: taste.version,
      model: "m",
      promptVersion: "p",
    });

    const markdown = await service.buildDailyReport("2026-11-27");
    assert.match(markdown, /### book-a/);
    assert.match(markdown, /4 星（追更）/);
    assert.match(markdown, /钩子不错/);
    assert.doesNotMatch(markdown, /雨夜正文不该出现/);
  }, { clock: CLOCK });
});

test("迁移：旧数据只归档、不折算星级；plan 可重复，源变则中止", async () => {  await withService(async (service, root) => {
    const dataRoot = path.join(root, ".dsh-novel-comment");
    await writeJson(path.join(dataRoot, "profiles.json"), [
      { id: "binge", name: "追更读者", kind: "binge", preferences: ["节奏快"], dislikes: ["拖沓"], readUpTo: "ch03" },
    ]);
    await writeJson(path.join(dataRoot, "reviews", "ch01--binge.json"), {
      id: "ch01--binge",
      chapterId: "ch01",
      profileId: "binge",
      scores: { 节奏: 8 },
      findings: [{ id: "x", kind: "experience", excerpt: "雨夜", note: "好" }],
      createdAt: "2026-11-20T00:00:00.000Z",
    });

    const plan = await planLegacyMigration(root);
    assert.equal(plan.profiles, 1);
    assert.equal(plan.reviews, 1);
    assert.equal(plan.unverifiable, 1);
    assert.equal(plan.alreadyMigrated, false);
    assert.ok(plan.blocked.some((b) => b.includes("不伪造") || b.includes("legacy-unverifiable")));

    const applied = await applyLegacyMigration(root, plan.planHash);
    assert.equal(applied.applied, true);
    assert.equal(applied.archived, 2);

    const again = await planLegacyMigration(root);
    assert.equal(again.alreadyMigrated, true);

    // 旧评分没有被折算成任何有效评分
    const ratings = await service.listRatings();
    assert.equal(ratings.length, 0);

    // 源文件变化后，用旧 planHash 再 apply 必须中止
    await writeJson(path.join(dataRoot, "profiles.json"), [{ id: "changed", name: "变了" }]);
    const stale = await applyLegacyMigration(root, plan.planHash);
    assert.equal(stale.applied, false);
    assert.match(stale.reason ?? "", /发生变化/);

    // 归档文件仍在
    const legacy = await readdir(path.join(dataRoot, "legacy", "v0.1"));
    assert.ok(legacy.includes("profiles.json"));
  }, { clock: CLOCK });
});

test("找书：按口味从假书源挑，跳过雷点", async () => {
  await withService(
    async (service) => {
      const reader = await service.createReaderFromTemplate("emotion");
      const { picks, searchedTags } = await service.discoverForReader(reader.id, 3);
      assert.ok(searchedTags.length > 0);
      assert.ok(picks.length > 0, "应挑出候选");
      assert.ok(picks.every((p) => !p.hitDislikedTags.includes("后宫")), "雷点书不能进候选");
      assert.equal(picks[0]!.book.bookId, "fake-emotion-1");
    },
    { clock: CLOCK, source: new FakeSource() },
  );
});

test("找书：没有书源时明确报错，不静默返回空", async () => {
  await withService(async (service) => {
    const reader = await service.createReaderFromTemplate("binge");
    await assert.rejects(() => service.discoverForReader(reader.id), /没有配置书源/);
  }, { clock: CLOCK });
});

test("评论区学习：只给分布与提示，不保留评论原文", async () => {
  await withService(
    async (service) => {
      const learned = await service.learnFromComments("fake-sys-1", "c1");
      assert.equal(learned.evidence.available, true);
      assert.ok(learned.hints.length > 0);
      const serialized = JSON.stringify(learned);
      assert.ok(!serialized.includes("这个系统设定有点意思"), "不能把评论原文带出来");
      assert.ok(learned.evidence.concerns.some((c) => c.label === "节奏" || c.label === "爽点"));
    },
    { clock: CLOCK, source: new FakeSource() },
  );
});

test("调度：峰时自动挂起、手动可跑；谷时自动放行", async () => {
  const peak = new Date("2026-11-25T02:30:00Z"); // 北京时间周三 10:30
  await withService(
    async (service) => {
      const reader = await service.createReaderFromTemplate("binge");
      const auto = await service.planSlots("auto");
      assert.equal(auto.allowed, false);
      assert.match(auto.reason ?? "", /高峰/);
      const manual = await service.planSlots("manual");
      assert.equal(manual.allowed, true);
      assert.deepEqual(manual.slots.map((s) => s.readerId), [reader.id]);
    },
    { clock: () => peak, source: new FakeSource() },
  );

  await withService(
    async (service) => {
      await service.createReaderFromTemplate("binge");
      const auto = await service.planSlots("auto");
      assert.equal(auto.allowed, true);
    },
    { clock: CLOCK, source: new FakeSource() },
  );
});

test("崩溃恢复：未完成日志重放，同一 txId 不重复计配额", async () => {
  await withService(async (service, root) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c", sequenceNumber: 1, title: "章", content: "正文" });

    const memory: ReadingMemory = { ...emptyReadingMemory(reader.id, "b"), readThrough: 1, updatedAt: new Date().toISOString() };
    const run = {
      schemaVersion: 2 as const,
      seq: 1000,
      txId: "tx-recover-1",
      kind: "read-chapter" as const,
      at: new Date().toISOString(),
      readerId: reader.id,
      bookId: "b",
      memory,
      usage: { date: "2026-11-27", delta: { chapters: 1, words: 2, tokens: 50, unknown: false } },
      requestId: "req-recover-1",
    };
    await writeJournalRun(service.dataRoot, run);
    await new ReaderService(root, { clock: CLOCK }).init();

    const quota = await service.quota("2026-11-27");
    assert.equal(quota.global.chapters, 1);
    assert.equal(quota.global.tokens, 50);
    assert.equal((await service.getReadingMemory(reader.id, "b"))?.readThrough, 1);

    // 同一 txId 再来一次（模拟重放两次）：不重复计入
    await writeJournalRun(service.dataRoot, run);
    await new ReaderService(root, { clock: CLOCK }).init();
    const again = await service.quota("2026-11-27");
    assert.equal(again.global.chapters, 1);
    assert.equal(again.global.tokens, 50);
  }, { clock: CLOCK });
});

test("崩溃恢复：旧日志不能把进度回滚（按 seq + 只前进）", async () => {
  await withService(async (service, root) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "一", content: "第一章" });
    await service.importChapter({ bookId: "b", chapterId: "c2", sequenceNumber: 2, title: "二", content: "第二章" });

    const base = emptyReadingMemory(reader.id, "b");
    const older = {
      ...base,
      readThrough: 1,
      updatedAt: "2026-11-27T00:00:00.000Z",
    };
    const newer = {
      ...base,
      readThrough: 2,
      updatedAt: "2026-11-27T00:01:00.000Z",
    };
    const makeRun = (seq: number, txId: string, memory: ReadingMemory) => ({
      schemaVersion: 2 as const,
      seq,
      txId,
      kind: "read-chapter" as const,
      at: memory.updatedAt,
      readerId: reader.id,
      bookId: "b",
      memory,
      usage: { date: "2026-11-27", delta: { chapters: 1, words: 2, tokens: 10, unknown: false } },
    });
    await writeJournalRun(service.dataRoot, makeRun(200, "tx-newer", newer));
    await writeJournalRun(service.dataRoot, makeRun(100, "tx-older", older));
    await new ReaderService(root, { clock: CLOCK }).init();

    const memory = await service.getReadingMemory(reader.id, "b");
    assert.equal(memory?.readThrough, 2);

    // 再来一条更旧的进度：不能回滚
    await writeJournalRun(service.dataRoot, makeRun(300, "tx-stale", older));
    await new ReaderService(root, { clock: CLOCK }).init();
    assert.equal((await service.getReadingMemory(reader.id, "b"))?.readThrough, 2);
  }, { clock: CLOCK });
});

test("安全：requestId 不能用于路径穿越覆盖其他文件", async () => {
  await withService(async (service) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c", sequenceNumber: 1, title: "章", content: "正文" });
    await assert.rejects(
      () => service.readChapter({ readerId: reader.id, bookId: "b", chapterId: "c", requestId: "../quota/2026-11-27" }),
      /非法 requestId/,
    );
  }, { clock: CLOCK });
});

test("改稿：重新导入第 1 章会让评审链失效（validThrough 回退、generation+1）", async () => {
  await withService(async (service) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "一", content: "旧版第一章" });
    await service.importChapter({ bookId: "b", chapterId: "c2", sequenceNumber: 2, title: "二", content: "第二章" });
    await service.saveReviewMemory({
      schemaVersion: 2,
      id: "mem",
      readerId: reader.id,
      bookId: "b",
      generation: 1,
      validThrough: 2,
      invalidFrom: null,
      entries: [],
      updatedAt: new Date().toISOString(),
    });

    await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "一", content: "改过的第一章" });
    const memory = await service.getReviewMemory(reader.id, "b");
    assert.equal(memory?.validThrough, 0);
    assert.equal(memory?.invalidFrom, 1);
    assert.equal(memory?.generation, 2);
  }, { clock: CLOCK });
});

test("崩溃恢复：readChapter 在写前恢复待处理日志（不会抢自己已持有的锁）", async () => {
  await withService(async (service, root) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "一", content: "第一章" });
    await service.importChapter({ bookId: "b", chapterId: "c2", sequenceNumber: 2, title: "二", content: "第二章" });

    const memory = { ...emptyReadingMemory(reader.id, "b"), readThrough: 1, updatedAt: new Date().toISOString() };
    await writeJournalRun(service.dataRoot, {
      schemaVersion: 2 as const,
      seq: 100,
      txId: "tx-inline",
      kind: "read-chapter" as const,
      at: memory.updatedAt,
      readerId: reader.id,
      bookId: "b",
      memory,
      usage: { date: "2026-11-27", delta: { chapters: 1, words: 2, tokens: 10, unknown: false } },
    });

    const result = await service.readChapter({ readerId: reader.id, bookId: "b", chapterId: "c2" });
    assert.equal(result.memory.readThrough, 2);
    const failed = await readdir(path.join(root, ".dsh-novel-comment", "journal", "failed")).catch(() => [] as string[]);
    assert.deepEqual(failed, []);
  }, { clock: CLOCK });
});

test("改稿中断后重试：只消费已落盘的失效标记，正常重复导入不换代", async () => {
  await withService(async (service, root) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "一", content: "第一章" });
    await service.saveReviewMemory({
      schemaVersion: 2,
      id: "mem",
      readerId: reader.id,
      bookId: "b",
      generation: 1,
      validThrough: 2,
      invalidFrom: null,
      entries: [],
      updatedAt: new Date().toISOString(),
    });

    // 正常重复导入（没有失效标记）：不应无故换代
    const again = await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "一", content: "第一章" });
    assert.equal(again.changed, false);
    assert.equal((await service.getReviewMemory(reader.id, "b"))?.generation, 1);

    // 模拟「写完标记后崩溃」：重试时消费标记并补做失效
    await writeJson(path.join(root, ".dsh-novel-comment", "books", "b", "invalidation", "1.json"), {
      schemaVersion: 2,
      bookId: "b",
      chapterId: "c1",
      sequenceNumber: 1,
      at: new Date().toISOString(),
    });
    const retry = await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "一", content: "第一章" });
    assert.equal(retry.changed, false);
    const memory = await service.getReviewMemory(reader.id, "b");
    assert.equal(memory?.validThrough, 0);
    assert.equal(memory?.generation, 2);
  }, { clock: CLOCK });
});

test("公开页：IPv4-mapped IPv6 也算私网", () => {
  assert.equal(isPrivateAddress("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateAddress("::ffff:7f00:1"), true);
  assert.equal(isPrivateAddress("::ffff:8.8.8.8"), false);
});

test("评分：非法目标类型被拒绝（不能绕过稿件门禁）", async () => {
  await withService(async (service) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    const taste = (await service.getTaste(reader.id))!;
    await assert.rejects(
      () =>
        service.saveRating({
          readerId: reader.id,
          target: { kind: "hack", bookId: "b", chapterId: "c", contentHash: "h" } as never,
          stars: 4,
          chapterComment: "好",
          status: "follow",
          tasteVersion: taste.version,
          model: "m",
          promptVersion: "p",
        }),
      /目标类型非法/,
    );
  }, { clock: CLOCK });
});

test("分歧：改稿后旧正文的评分不参与比较", async () => {
  await withService(async (service) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    const taste = (await service.getTaste(reader.id))!;
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c", sequenceNumber: 1, title: "章", content: "第一版正文" });
    const v1 = (await service.getChapter("b", "c"))!;
    await service.saveRating({
      readerId: reader.id,
      target: { kind: "manuscript", bookId: "b", chapterId: "c", contentHash: v1.contentHash, chapterNumber: 1, revision: v1.revision },
      stars: 5,
      chapterComment: "旧版好评",
      status: "follow",
      tasteVersion: taste.version,
      model: "m",
      promptVersion: "p",
    });
    await service.importChapter({ bookId: "b", chapterId: "c", sequenceNumber: 1, title: "章", content: "第二版正文" });
    const comparison = await service.compareChapter({ bookId: "b", chapterId: "c", revision: 2 });
    assert.equal(comparison.rows.length, 0, "旧正文评分不能混进新版本比较");
    assert.equal(comparison.attribution, "incomparable");
  }, { clock: CLOCK });
});

test("崩溃恢复：身份不一致的日志被隔离，不覆盖任何记忆", async () => {
  await withService(async (service, root) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c", sequenceNumber: 1, title: "章", content: "正文" });
    const memory = { ...emptyReadingMemory("someone-else", "b"), readThrough: 1, updatedAt: new Date().toISOString() };
    await writeJournalRun(service.dataRoot, {
      schemaVersion: 2 as const,
      seq: 100,
      txId: "tx-bad-identity",
      kind: "read-chapter" as const,
      at: memory.updatedAt,
      readerId: reader.id,
      bookId: "b",
      memory,
      usage: { date: "2026-11-27", delta: { chapters: 1, words: 2, tokens: 10, unknown: false } },
    });
    await new ReaderService(root, { clock: CLOCK }).init();
    assert.equal(await service.getReadingMemory(reader.id, "b"), null);
    const failed = await readdir(path.join(root, ".dsh-novel-comment", "journal", "failed")).catch(() => [] as string[]);
    assert.equal(failed.length, 1);
  }, { clock: CLOCK });
});

test("崩溃恢复：结构残缺的记忆日志被隔离，不覆盖正常数据", async () => {
  await withService(async (service, root) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c", sequenceNumber: 1, title: "章", content: "正文" });
    await writeJournalRun(service.dataRoot, {
      schemaVersion: 2 as const,
      seq: 100,
      txId: "tx-broken-memory",
      kind: "read-chapter" as const,
      at: new Date().toISOString(),
      readerId: reader.id,
      bookId: "b",
      memory: { schemaVersion: 2, id: "m", readerId: reader.id, bookId: "b", readThrough: 1 } as never,
      usage: { date: "2026-11-27", delta: { chapters: 1, words: 2, tokens: 10, unknown: false } },
    });
    await new ReaderService(root, { clock: CLOCK }).init();
    assert.equal(await service.getReadingMemory(reader.id, "b"), null);
    const failed = await readdir(path.join(root, ".dsh-novel-comment", "journal", "failed"));
    assert.equal(failed.length, 1);
  }, { clock: CLOCK });
});

test("崩溃恢复：应用失败时保留日志并报错，不静默丢弃", async () => {
  await withService(async (service, root) => {
    const memory = { ...emptyReadingMemory("ghost", "b"), readThrough: 1, updatedAt: new Date().toISOString() };
    await writeJournalRun(service.dataRoot, {
      schemaVersion: 2 as const,
      seq: 100,
      txId: "tx-ghost",
      kind: "read-chapter" as const,
      at: memory.updatedAt,
      readerId: "ghost",
      bookId: "b",
      memory,
      usage: { date: "2026-11-27", delta: { chapters: 1, words: 2, tokens: 10, unknown: false } },
    });
    await assert.rejects(() => new ReaderService(root, { clock: CLOCK }).init(), /恢复失败/);
    const pending = await readdir(path.join(root, ".dsh-novel-comment", "journal", "pending"));
    assert.equal(pending.length, 1, "失败日志必须留在 pending 等人工处理");
  }, { clock: CLOCK });
});

test("评分：作者稿第 2 章缺第 1 章评审记忆时拒绝，补记忆后可评", async () => {
  await withService(async (service) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    const taste = (await service.getTaste(reader.id))!;
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "一", content: "第一章" });
    await service.importChapter({ bookId: "b", chapterId: "c2", sequenceNumber: 2, title: "二", content: "第二章" });
    const c2 = (await service.getChapter("b", "c2"))!;
    const draft = {
      readerId: reader.id,
      target: { kind: "manuscript" as const, bookId: "b", chapterId: "c2", contentHash: c2.contentHash, chapterNumber: 2, revision: c2.revision },
      stars: 4 as const,
      chapterComment: "好",
      status: "follow" as const,
      tasteVersion: taste.version,
      model: "m",
      promptVersion: "p",
    };
    await assert.rejects(() => service.saveRating(draft), /不能直接评第 2 章/);

    await service.saveReviewMemory({
      schemaVersion: 2,
      id: "mem",
      readerId: reader.id,
      bookId: "b",
      generation: 1,
      validThrough: 1,
      invalidFrom: null,
      entries: [{ chapterNumber: 1, memory: "读到第一章" }],
      updatedAt: new Date().toISOString(),
    });
    const saved = await service.saveRating(draft);
    assert.equal(saved.stars, 4);
  }, { clock: CLOCK });
});

test("安全：bookId/chapterId/日期路径穿越一律拒绝", async () => {
  await withService(async (service) => {
    await assert.rejects(() => service.importBook({ bookId: "../evil", title: "x" }), /非法 bookId/);
    await service.importBook({ bookId: "ok", title: "书" });
    await assert.rejects(
      () => service.importChapter({ bookId: "ok", chapterId: "a/b", sequenceNumber: 1, title: "x", content: "y" }),
      /非法 chapterId/,
    );
    await assert.rejects(() => service.writeReport("../../evil", "x"), /非法日期/);
    await assert.rejects(() => service.readReport("2026-1-1"), /非法日期/);
  }, { clock: CLOCK });
});

test("安全：readChapter 的 memoryPatch 不能改身份字段", async () => {
  await withService(async (service) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c", sequenceNumber: 1, title: "章", content: "正文" });
    const result = await service.readChapter({
      readerId: reader.id,
      bookId: "b",
      chapterId: "c",
      memoryPatch: { readerId: "someone-else", bookId: "other" } as never,
    });
    assert.equal(result.memory.readerId, reader.id);
    assert.equal(result.memory.bookId, "b");
  }, { clock: CLOCK });
});

test("安全：权威文件损坏时停止写入，不重置进度/配额", async () => {
  await withService(async (service, root) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c", sequenceNumber: 1, title: "章", content: "正文" });
    await service.importChapter({ bookId: "b", chapterId: "c2", sequenceNumber: 2, title: "第二章", content: "第二章正文" });
    await service.readChapter({ readerId: reader.id, bookId: "b", chapterId: "c" });
    const quotaFile = path.join(root, ".dsh-novel-comment", "quota", "2026-11-27.json");
    await writeFile(quotaFile, "{broken", "utf8");
    await assert.rejects(() => service.quota(), /损坏/);
    await assert.rejects(() => service.readChapter({ readerId: reader.id, bookId: "b", chapterId: "c2" }), /损坏/);
  }, { clock: CLOCK });
});

test("评分：目标正文指纹/版本不一致时拒绝，防止给旧稿打分冒充当前", async () => {
  await withService(async (service) => {
    const reader = await service.createReader({ name: "甲", persona: "x" });
    const taste = (await service.getTaste(reader.id))!;
    await service.importBook({ bookId: "b", title: "书" });
    await service.importChapter({ bookId: "b", chapterId: "c", sequenceNumber: 1, title: "章", content: "正文" });
    const chapter = (await service.getChapter("b", "c"))!;
    await assert.rejects(
      () =>
        service.saveRating({
          readerId: reader.id,
          target: { kind: "manuscript", bookId: "b", chapterId: "c", contentHash: "wrong-hash", chapterNumber: 1, revision: chapter.revision },
          stars: 4,
          chapterComment: "好",
          status: "follow",
          tasteVersion: taste.version,
          model: "m",
          promptVersion: "p",
        }),
      /指纹/,
    );
    await assert.rejects(
      () =>
        service.saveRating({
          readerId: reader.id,
          target: { kind: "manuscript", bookId: "b", chapterId: "c", contentHash: chapter.contentHash, chapterNumber: 1, revision: chapter.revision + 5 },
          stars: 4,
          chapterComment: "好",
          status: "follow",
          tasteVersion: taste.version,
          model: "m",
          promptVersion: "p",
        }),
      /稿件版本/,
    );
  }, { clock: CLOCK });
});

test("读者跨工作区共享，评分/记忆仍随书留在各自工作区", async () => {
  const global = await mkdtemp(path.join(tmpdir(), "reader-global-"));
  const wsA = await mkdtemp(path.join(tmpdir(), "reader-wsA-"));
  const wsB = await mkdtemp(path.join(tmpdir(), "reader-wsB-"));
  try {
    const a = await new ReaderService(wsA, { globalRoot: global, clock: CLOCK }).init();
    const reader = await a.createReader({ name: "共享读者", persona: "只看爽点" });
    await a.importBook({ bookId: "book-a", title: "A 书" });
    await a.importChapter({ bookId: "book-a", chapterId: "c1", sequenceNumber: 1, title: "一", content: "第一章正文" });

    const b = await new ReaderService(wsB, { globalRoot: global, clock: CLOCK }).init();
    const seen = await b.listReaders();
    assert.equal(seen.some((r) => r.id === reader.id), true, "B 工作区应看到同一批读者");
    assert.equal((await b.listBooks()).length, 0, "B 工作区不应看到 A 的书");
    assert.equal((await b.listRatings()).length, 0, "B 工作区不应看到 A 的评分");
  } finally {
    await rm(global, { recursive: true, force: true });
    await rm(wsA, { recursive: true, force: true });
    await rm(wsB, { recursive: true, force: true });
  }
});

test("标签搜索：按标签命中假书源，雷点硬排除", async () => {
  await withService(
    async (service) => {
      const found = await service.searchByTags({ tags: ["系统流", "末世"], excludeTags: ["甜宠"], limit: 5 });
      assert.ok(found.picks.length > 0, "应命中系统流/末世的假书");
      assert.equal(found.picks[0]!.book.bookId, "fake-sys-1");
      assert.ok(found.picks.every((pick) => pick.book.bookId !== "fake-emotion-1"), "雷点（甜宠）书必须硬排除");
      assert.deepEqual([...found.searchedTags].sort(), ["末世", "系统流"].sort());
      assert.deepEqual(found.unknownTags, []);
    },
    { clock: CLOCK, source: new FakeSource() },
  );
});

test("标签搜索：别名归一到规范标签", async () => {
  await withService(
    async (service) => {
      const found = await service.searchByTags({ tags: ["系统文", "末日"], limit: 3 });
      assert.deepEqual([...found.searchedTags].sort(), ["末世", "系统流"].sort());
      assert.ok(found.picks.some((pick) => pick.book.bookId === "fake-sys-1"));
    },
    { clock: CLOCK, source: new FakeSource() },
  );
});

test("标签搜索：未知标签不静默丢弃，随 unknownTags 回传", async () => {
  await withService(
    async (service) => {
      const found = await service.searchByTags({ tags: ["不存在的标签"] });
      assert.deepEqual(found.unknownTags, ["不存在的标签"]);
      assert.equal(found.picks.length, 0);
    },
    { clock: CLOCK, source: new FakeSource() },
  );
});

test("标签搜索：空标签直接拒绝", async () => {
  await withService(
    async (service) => {
      await assert.rejects(() => service.searchByTags({}), /至少选一个标签/);
    },
    { clock: CLOCK, source: new FakeSource() },
  );
});

test("标签目录：六类齐全且含附录 A 点名标签与别名", async () => {
  await withService(async (service) => {
    const catalog = service.listTagCatalog();
    assert.equal(catalog.categories.length, 6);
    const all = new Set(catalog.categories.flatMap((category) => category.tags));
    for (const tag of ["系统流", "多女主", "单女主", "追妻火葬场", "克苏鲁", "灵气复苏", "扮猪吃虎", "第一人称", "烂尾预警"]) {
      assert.ok(all.has(tag), `标签库缺少 ${tag}`);
    }
    assert.equal(catalog.aliases["末日"], "末世");
    assert.equal(catalog.aliases["1v1"], "单女主");
  }, { clock: CLOCK });
});

test("改口味标签：生成新版本，别名归一且内容不变不升版", async () => {
  await withService(async (service) => {
    const reader = await service.createReaderFromTemplate("binge");
    const before = await service.getTaste(reader.id);
    assert.ok(before);
    const next = await service.updateReaderTags(reader.id, ["系统文"], ["后宫"]);
    assert.notEqual(next.version, before!.version);
    assert.deepEqual(next.likedTags.map((tag) => tag.tagId), ["系统流"]);
    assert.deepEqual(next.dislikedTags.map((tag) => tag.tagId), ["后宫"]);
    const again = await service.updateReaderTags(reader.id, ["系统流"], ["后宫"]);
    assert.equal(again.version, next.version, "内容不变不应产生新版本");
  }, { clock: CLOCK });
});

test("加入书架：只存书目元信息，不建章节、不拉正文", async () => {
  await withService(async (service) => {
    const book = await service.addToShelf({
      bookId: "fake-sys-1",
      title: "我在末日开系统",
      author: "老K",
      tags: ["末世", "系统流"],
      sourceId: "fake",
      sourceSite: "fake.local",
    });
    assert.equal(book.accessLevel, "public");
    assert.deepEqual(book.tags, ["末世", "系统流"]);
    assert.equal(book.author, "老K");
    assert.equal((await service.listChapters("fake-sys-1")).length, 0);
    assert.equal((await service.listBooks()).length, 1);
  }, { clock: CLOCK });
});

test("它读过的书：按读者 + 书聚合最近一条评分", async () => {
  await withService(async (service) => {
    const reader = await service.createReaderFromTemplate("binge");
    await service.importBook({ bookId: "b", title: "示例书" });
    const chapter = await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "第一章", content: "雨从傍晚开始下。\n\n巷口的灯坏了。" });
    const taste = await service.getTaste(reader.id);
    await service.saveRating({
      readerId: reader.id,
      target: { kind: "manuscript", bookId: "b", chapterId: "c1", contentHash: chapter.contentHash, chapterNumber: 1, revision: chapter.revision },
      stars: 5,
      chapterComment: "好看。",
      status: "follow",
      tasteVersion: taste!.version,
      model: "manual",
      promptVersion: "manual",
    });
    const shelf = await service.readingShelf(reader.id);
    assert.equal(shelf.length, 1);
    assert.equal(shelf[0]!.bookId, "b");
    assert.equal(shelf[0]!.title, "示例书");
    assert.equal(shelf[0]!.stars, 5);
    assert.equal(shelf[0]!.ratings, 1);
    assert.equal(shelf[0]!.chapterNumber, 1);
    assert.deepEqual(await service.readingShelf("other-reader"), []);
  }, { clock: CLOCK });
});

test("加入书架：同源重复幂等，异源/已导入书拒绝覆盖", async () => {
  await withService(async (service) => {
    const first = await service.addToShelf({ bookId: "fake-sys-1", title: "我在末日开系统", sourceId: "fake", sourceSite: "fake.local", tags: ["末世"] });
    assert.equal(first.title, "我在末日开系统");
    const again = await service.addToShelf({ bookId: "fake-sys-1", title: "改过的标题", sourceId: "fake", sourceSite: "fake.local" });
    assert.equal(again.title, "我在末日开系统", "同源重复添加不应覆盖已有元信息");
    await assert.rejects(
      () => service.addToShelf({ bookId: "fake-sys-1", title: "x", sourceId: "other" }),
      /来源不同/,
    );
    await service.importBook({ bookId: "mine", title: "我的稿" });
    await assert.rejects(
      () => service.addToShelf({ bookId: "mine", title: "我的稿", sourceId: "fake" }),
      /来源不同/,
    );
  }, { clock: CLOCK });
});
