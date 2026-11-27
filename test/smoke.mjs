import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ReaderService } from "../lib/reader-core.mjs";
import { apply } from "../index.js";

const CONTENT = "雨从傍晚开始下，一直没有停。\n\n巷口的灯坏了三个月，没人来修。";

test("包内置的核心可用：建读者 → 导章 → 手工评分 → 日报", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsh-reader-"));
  try {
    const service = await new ReaderService(root, { clock: () => new Date("2026-11-27T12:00:00Z") }).init();
    const reader = await service.createReaderFromTemplate("binge");
    await service.importBook({ bookId: "b", title: "示例" });
    const chapter = await service.importChapter({ bookId: "b", chapterId: "c1", sequenceNumber: 1, title: "第一章", content: CONTENT });
    const taste = await service.getTaste(reader.id);
    await service.saveRating({
      readerId: reader.id,
      target: { kind: "manuscript", bookId: "b", chapterId: "c1", contentHash: chapter.contentHash, chapterNumber: 1, revision: chapter.revision },
      stars: 4,
      chapterComment: "有钩子。",
      status: "follow",
      tasteVersion: taste.version,
      model: "manual",
      promptVersion: "manual",
    });
    const report = await service.buildDailyReport("2026-11-27");
    assert.match(report, /### b/);
    assert.match(report, /4 星/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("apply 注册五个工具，并受 ctx.effect 管理", () => {
  const registered = [];
  const disposers = [];
  const ctx = {
    effect(fn) {
      const dispose = fn();
      disposers.push(dispose);
    },
    tools: {
      register(definition) {
        registered.push(definition.name);
        return () => undefined;
      },
    },
  };
  apply(ctx);
  assert.deepEqual(registered.sort(), ["reader_books", "reader_discover", "reader_rate", "reader_report", "reader_review"]);
  assert.equal(disposers.length, 5);
});

test("未配置模型时 reader_review 明确报错，不静默冒充评审", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsh-reader-"));
  try {
    const tool = collectTool("reader_review");
    const result = await tool.execute(
      { dir: root, readerId: "r", bookId: "b", chapterId: "c" },
      undefined,
      { cwd: root },
    );
    assert.equal(result.error, "model-not-configured");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function collectTool(name) {
  let found = null;
  apply({
    effect(fn) {
      fn();
    },
    tools: {
      register(definition) {
        if (definition.name === name) found = definition;
        return () => undefined;
      },
    },
  });
  assert.ok(found, `没有注册 ${name}`);
  return found;
}

test("remote 契约：客户端与 Host 的方法集合一致", async () => {
  const { readFile } = await import("node:fs/promises");
  const clientSource = await readFile(new URL("../client.js", import.meta.url), "utf8");
  const hostSource = await readFile(new URL("../lib/remote-contract.js", import.meta.url), "utf8");
  const clientMethods = [...clientSource.matchAll(/invoke\("([A-Za-z]+)"/gu)].map((match) => match[1]).sort();
  const hostMethods = [...hostSource.matchAll(/invocation\("([A-Za-z]+)"/gu)].map((match) => match[1]).sort();
  assert.deepEqual(clientMethods, hostMethods, "client.js 与 lib/remote-contract.js 必须同步");
});
