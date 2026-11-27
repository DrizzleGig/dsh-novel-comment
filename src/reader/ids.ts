/** 数据根与 ID 规则：小写 ASCII，拒绝路径穿越与 Windows 保留名。 */

import { shortHash } from "./hash.ts";

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const WINDOWS_RESERVED = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

export function isSafeId(id: string): boolean {
  if (typeof id !== "string" || !ID_RE.test(id)) return false;
  return !WINDOWS_RESERVED.has(id);
}

export function assertSafeId(id: string, label = "id"): void {
  if (!isSafeId(id)) {
    throw new Error(`非法 ${label}：${JSON.stringify(id)}（只允许小写字母/数字/下划线/短横，1–64 位，且不能是 Windows 保留名）`);
  }
}

/** 从任意标题生成稳定 id 片段（用于书/章 id 的默认建议值） */
export function slugify(input: string): string {
  const ascii = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (ascii) return ascii;
  // 纯中文等没有 ASCII 的名字：用内容哈希兜底，保证 id 合法且稳定
  return `r-${shortHash(input)}`;
}
