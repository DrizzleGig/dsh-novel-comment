import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readPublicPage } from "../../src/adapter/page-reader.ts";
import { ReaderService } from "../../src/adapter/service.ts";
import { SourceStopError } from "../../src/reader/index.ts";

async function withServer(handler: Parameters<typeof createServer>[1], fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const LOCAL = { allowPrivateHosts: true } as const;

test("公开页：读标题与正文（去脚本/样式）", async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><head><title>测试页</title><style>.x{}</style></head><body><script>alert(1)</script><p>第一段</p><p>第二段</p></body></html>");
    },
    async (base) => {
      const page = await readPublicPage(`${base}/ok.html`, { allowedHosts: ["127.0.0.1"], ...LOCAL });
      assert.equal(page.title, "测试页");
      assert.match(page.text, /第一段/);
      assert.match(page.text, /第二段/);
      assert.doesNotMatch(page.text, /alert/);
    },
  );
});

test("公开页：站点不在允许列表直接拒绝", async () => {
  await assert.rejects(
    () => readPublicPage("https://example.com/a", { allowedHosts: ["127.0.0.1"], ...LOCAL }),
    (error: unknown) => error instanceof SourceStopError && error.reason === "unsupported",
  );
});

test("公开页：默认拒绝本机/私网地址（防 DNS 重绑定）", async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    },
    async (base) => {
      await assert.rejects(
        () => readPublicPage(`${base}/x`, { allowedHosts: ["127.0.0.1"] }),
        (error: unknown) => error instanceof SourceStopError && error.reason === "unsupported" && /私网/.test(error.message),
      );
    },
  );
});

test("公开页：重定向到不在允许列表的站点会被拦下", async () => {
  await withServer(
    (req, res) => {
      res.writeHead(302, { location: "https://evil.example/secret" });
      res.end();
    },
    async (base) => {
      await assert.rejects(
        () => readPublicPage(`${base}/redir`, { allowedHosts: ["127.0.0.1"], ...LOCAL }),
        (error: unknown) => error instanceof SourceStopError && error.reason === "unsupported" && /允许列表/.test(error.message),
      );
    },
  );
});

test("公开页：403 视为付费墙/需登录并停止", async () => {
  await withServer(
    (req, res) => {
      res.writeHead(403);
      res.end("forbidden");
    },
    async (base) => {
      await assert.rejects(
        () => readPublicPage(`${base}/x`, { allowedHosts: ["127.0.0.1"], ...LOCAL }),
        (error: unknown) => error instanceof SourceStopError && error.reason === "paywall",
      );
    },
  );
});

test("公开页：验证码页面停止", async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>请完成验证码后继续</body></html>");
    },
    async (base) => {
      await assert.rejects(
        () => readPublicPage(`${base}/x`, { allowedHosts: ["127.0.0.1"], ...LOCAL }),
        (error: unknown) => error instanceof SourceStopError && error.reason === "captcha",
      );
    },
  );
});

test("公开页：超过大小上限时边读边中止", async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("字".repeat(200));
    },
    async (base) => {
      await assert.rejects(
        () => readPublicPage(`${base}/x`, { allowedHosts: ["127.0.0.1"], maxBytes: 100, ...LOCAL }),
        (error: unknown) => error instanceof SourceStopError && error.reason === "unsupported",
      );
    },
  );
});

test("服务：公开页只存短摘录，不落外部正文", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reader-page-"));
  try {
    await withServer(
      (req, res) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<html><head><title>某站公开页</title></head><body><p>${"公开正文".repeat(200)}</p></body></html>`);
      },
      async (base) => {
        const service = await new ReaderService(root, {
          clock: () => new Date("2026-11-27T12:00:00Z"),
          allowedPageHosts: ["127.0.0.1"],
          allowPrivateHosts: true,
        }).init();
        const imported = await service.importFromUrl({
          url: `${base}/chapter.html`,
          bookId: "web-book",
          chapterId: "c1",
          sequenceNumber: 1,
        });
        assert.equal(imported.book.accessLevel, "public");
        assert.equal(imported.chapter.contentOrigin, "public-page");
        assert.ok(imported.chapter.excerpt && [...imported.chapter.excerpt].length <= 300);
        assert.equal(await service.getChapterContent("web-book", "c1"), null);
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
