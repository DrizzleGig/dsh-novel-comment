import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalTag, normalizeTags, TAG_CATEGORIES } from "../../src/reader/tags.ts";

test("附录 A 必备标签都在库中", () => {
  for (const tag of ["系统流", "穿越", "重生", "多女主", "单女主", "后宫", "穿书", "快穿", "无限流", "追妻火葬场"]) {
    assert.ok(TAG_CATEGORIES.some((c) => c.tags.includes(tag)), `缺少标签：${tag}`);
    assert.equal(canonicalTag(tag), tag);
  }
});

test("别名映射到规范标签，未知标签不冒充", () => {
  assert.equal(canonicalTag("面板流"), "系统流");
  assert.equal(canonicalTag("魂穿"), "穿越");
  assert.equal(canonicalTag("1v1"), "单女主");
  const result = normalizeTags(["系统文", "不知道的标签"]);
  assert.deepEqual(result.known, ["系统流"]);
  assert.deepEqual(result.unknown, ["不知道的标签"]);
});
