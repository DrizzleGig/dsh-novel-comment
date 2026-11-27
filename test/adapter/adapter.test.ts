import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ReaderService } from "../../src/adapter/service.ts";
import { ReaderAdapter } from "../../src/adapter/adapter.ts";

async function withAdapter(fn: (adapter: ReaderAdapter, service: ReaderService) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "reader-adapter-facade-"));
  try {
    const service = await new ReaderService(root, { clock: () => new Date("2026-11-27T12:00:00Z") }).init();
    await fn(new ReaderAdapter(service), service);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("门面：Command 建读者 + Query 列表", async () => {
  await withAdapter(async (adapter) => {
    const created = await adapter.command<{ id: string }>({ plugin: "reader", command: "reader.create", input: { templateId: "binge" } });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.match(created.data.id, /^r-/);

    const list = await adapter.query<{ readers: unknown[] }>({ plugin: "reader", query: "readers.list" });
    assert.equal(list.ok, true);
    if (!list.ok) return;
    assert.equal(list.data.readers.length, 1);
  });
});

test("门面：导入章节 + 评分 + 分歧查询走完整链路", async () => {
  await withAdapter(async (adapter) => {
    const a = await adapter.command<{ id: string }>({ plugin: "reader", command: "reader.create", input: { templateId: "binge" } });
    const b = await adapter.command<{ id: string }>({ plugin: "reader", command: "reader.create", input: { templateId: "plot" } });
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) return;

    const book = await adapter.command({ plugin: "reader", command: "book.import", input: { bookId: "b1", title: "示例" } });
    assert.equal(book.ok, true);
    const imported = await adapter.command<{ contentHash: string; revision: number }>({
      plugin: "reader",
      command: "chapter.import",
      input: { bookId: "b1", chapterId: "c1", sequenceNumber: 1, title: "第一章", content: "雨夜。\n\n巷口的灯坏了。" },
    });
    assert.equal(imported.ok, true);
    if (!imported.ok) return;

    const target = { kind: "manuscript" as const, bookId: "b1", chapterId: "c1", contentHash: imported.data.contentHash, chapterNumber: 1, revision: imported.data.revision };

    for (const [readerId, stars] of [[a.data.id, 5], [b.data.id, 2]] as Array<[string, number]>) {
      const tasteResult = await adapter.query<{ taste: { version: string } }>({ plugin: "reader", query: "reader.get", input: { readerId } });
      assert.ok(tasteResult.ok);
      if (!tasteResult.ok) return;
      const saved: { ok: boolean } = await adapter.command<{ id: string }>({
        plugin: "reader",
        command: "rating.save",
        input: {
          readerId,
          target,
          stars,
          chapterComment: stars === 5 ? "好" : "一般",
          status: stars === 5 ? "follow" : "watch",
          tasteVersion: tasteResult.data.taste.version,
          model: "m",
          promptVersion: "p",
        },
      });
      assert.equal(saved.ok, true);
    }

    const comparison = await adapter.query<{ attribution: string; spread: number }>({
      plugin: "reader",
      query: "comparison.get",
      input: { bookId: "b1", chapterId: "c1", revision: imported.data.revision },
    });
    assert.equal(comparison.ok, true);
    if (!comparison.ok) return;
    assert.equal(comparison.data.attribution, "taste_difference");
    assert.equal(comparison.data.spread, 3);
  });
});

test("门面：未知查询返回 UNSUPPORTED；非法星级映射成 VALIDATION_FAILED", async () => {
  await withAdapter(async (adapter) => {
    const unknown = await adapter.query({ plugin: "reader", query: "nope" });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.error.code, "UNSUPPORTED");

    const created = await adapter.command<{ id: string }>({ plugin: "reader", command: "reader.create", input: { templateId: "binge" } });
    assert.ok(created.ok);
    if (!created.ok) return;
    const bad = await adapter.command({
      plugin: "reader",
      command: "rating.save",
      input: {
        readerId: created.data.id,
        target: { kind: "manuscript", bookId: "b", chapterId: "c", contentHash: "h", chapterNumber: 1, revision: 1 },
        stars: 0,
        chapterComment: "x",
        status: "follow",
        tasteVersion: "t",
        model: "m",
        promptVersion: "p",
      },
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.error.code, "VALIDATION_FAILED");
  });
});

test("门面：Validate workspace 正常返回 ok", async () => {
  await withAdapter(async (adapter) => {
    const result = await adapter.validate({ plugin: "reader" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.problems, []);
  });
});
