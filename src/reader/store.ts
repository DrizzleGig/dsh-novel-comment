import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ChapterReview, ReaderProfile } from "../core/index.ts";
import { READER_DIR, type ReaderSnapshot } from "./types.ts";
import { clonePresets } from "./profiles.ts";

/**
 * reader 包的本地存储 — 只写 `.dsh-novel-comment/`，不碰其他包目录。
 *
 * 布局：
 *   .dsh-novel-comment/
 *     profiles.json
 *     preferences.json
 *     reviews/<chapterId>--<profileId>.json
 */

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function assertSafeId(id: string, label = "id"): void {
  if (!ID_RE.test(id)) {
    throw new Error(`非法 ${label}：${id}`);
  }
}

export class ReaderStore {
  readonly root: string;

  constructor(workspaceRoot: string) {
    this.root = path.join(workspaceRoot, READER_DIR);
  }

  private p(...parts: string[]): string {
    return path.join(this.root, ...parts);
  }

  async ensure(): Promise<void> {
    await mkdir(this.p("reviews"), { recursive: true });
  }

  async readProfiles(): Promise<ReaderProfile[]> {
    const file = this.p("profiles.json");
    if (!existsSync(file)) return clonePresets();
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as ReaderProfile[];
  }

  async writeProfiles(profiles: ReaderProfile[]): Promise<void> {
    await this.atomicWrite("profiles.json", JSON.stringify(profiles, null, 2));
  }

  async readReview(chapterId: string, profileId: string): Promise<ChapterReview | null> {
    assertSafeId(chapterId, "chapterId");
    assertSafeId(profileId, "profileId");
    const file = this.p("reviews", `${chapterId}--${profileId}.json`);
    if (!existsSync(file)) return null;
    return JSON.parse(await readFile(file, "utf8")) as ChapterReview;
  }

  async writeReview(review: ChapterReview): Promise<void> {
    assertSafeId(review.chapterId, "chapterId");
    assertSafeId(review.profileId, "profileId");
    await this.ensure();
    await this.atomicWrite(
      path.join("reviews", `${review.chapterId}--${review.profileId}.json`),
      JSON.stringify(review, null, 2),
    );
  }

  async listReviews(): Promise<ChapterReview[]> {
    const dir = this.p("reviews");
    if (!existsSync(dir)) return [];
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(dir);
    const out: ChapterReview[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        out.push(JSON.parse(await readFile(path.join(dir, name), "utf8")) as ChapterReview);
      } catch {
        // 单条损坏不阻断整体读取
      }
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async snapshot(): Promise<ReaderSnapshot> {
    return { profiles: await this.readProfiles(), reviews: await this.listReviews() };
  }

  /** 原子写：先写临时文件再 rename，中断不会留下半个 JSON */
  private async atomicWrite(relPath: string, content: string): Promise<void> {
    const target = this.p(relPath);
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, content, "utf8");
    await rename(tmp, target);
  }
}
