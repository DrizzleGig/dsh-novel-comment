/**
 * 网文标签库（首批）：大类 + 子标签 + 别名映射。
 * 规则：站点标签先走别名表；对不上的标「未知」，不冒充站点事实。
 */

export interface TagCategory {
  id: string;
  label: string;
  tags: string[];
}

export const TAG_CATEGORIES: TagCategory[] = [
  {
    id: "world",
    label: "题材 / 世界观",
    tags: ["都市", "仙侠", "玄幻", "奇幻", "科幻", "末世", "历史", "武侠", "悬疑", "灵异", "游戏", "电竞", "校园", "职场", "娱乐圈", "年代", "军事", "体育", "赛博", "克苏鲁", "灵气复苏"],
  },
  {
    id: "plot",
    label: "剧情机制",
    tags: ["系统流", "穿越", "重生", "穿书", "快穿", "无限流", "诸天万界", "签到流", "直播流", "种田", "经营", "复仇", "探案", "升级", "无敌流", "扮猪吃虎", "废柴逆袭", "龙傲天", "群像冒险", "单元剧"],
  },
  {
    id: "romance",
    label: "感情结构与角色",
    tags: ["单女主", "多女主", "后宫", "无 CP", "双强", "群像", "师徒", "青梅竹马", "先婚后爱", "追妻火葬场", "破镜重圆", "暗恋", "甜宠", "虐恋", "宫斗", "宅斗", "豪门"],
  },
  {
    id: "pace",
    label: "节奏与结构",
    tags: ["快节奏", "慢热", "强钩子", "日常向", "主线推进", "伏笔密集", "短平快", "长篇铺陈"],
  },
  {
    id: "style",
    label: "语气与风格",
    tags: ["爽文", "轻松搞笑", "温馨治愈", "暗黑压抑", "严肃", "考据", "对白密集", "描写细腻", "第一人称", "多视角"],
  },
  {
    id: "boundary",
    label: "内容边界（只作偏好，不作风评）",
    tags: ["主角性别", "感情线有无", "暴力程度", "悲剧结局", "系统是否拟人", "是否虐主", "烂尾预警"],
  },
];

/** 别名 → 规范标签（小写键） */
export const TAG_ALIASES: Record<string, string> = {
  末日: "末世",
  惊悚: "灵异",
  赛博朋克: "赛博",
  系统文: "系统流",
  面板流: "系统流",
  魂穿: "穿越",
  身穿: "穿越",
  轮回流: "无限流",
  副本流: "无限流",
  碾压流: "无敌流",
  藏拙: "扮猪吃虎",
  低调流: "扮猪吃虎",
  "1v1": "单女主",
  宠文: "甜宠",
  女强: "双强",
  男强: "双强",
  爽: "爽文",
  搞笑: "轻松搞笑",
  治愈: "温馨治愈",
  黑暗: "暗黑压抑",
};

export interface TagCatalog {
  categories: TagCategory[];
  aliases: Record<string, string>;
}

/** Host → 面板的标签目录（唯一真源；客户端不另抄一份） */
export function tagCatalog(): TagCatalog {
  return {
    categories: TAG_CATEGORIES.map((c) => ({ ...c, tags: [...c.tags] })),
    aliases: { ...TAG_ALIASES },
  };
}

/** 解析一个标签：命中返回规范标签；未命中返回原值并标 known=false（不冒充已知） */
export function resolveTag(input: string): { tag: string; known: boolean } {
  const raw = String(input ?? "").trim();
  const canonical = canonicalTag(raw);
  return canonical ? { tag: canonical, known: true } : { tag: raw, known: false };
}

const ALL_TAGS: string[] = TAG_CATEGORIES.flatMap((c) => c.tags);
const TAG_BY_LOWER = new Map(ALL_TAGS.map((t) => [t.toLowerCase(), t]));

export function canonicalTag(input: string): string | null {
  const key = input.trim().toLowerCase();
  if (!key) return null;
  const aliased = TAG_ALIASES[key];
  if (aliased) return aliased;
  return TAG_BY_LOWER.get(key) ?? null;
}

/** 站点标签 → 规范标签；对不上的进 unknown（不冒充已知） */
export function normalizeTags(tags: string[]): { known: string[]; unknown: string[]; aliased: Record<string, string> } {
  const known = new Set<string>();
  const unknown = new Set<string>();
  const aliased: Record<string, string> = {};
  for (const raw of tags) {
    const tag = canonicalTag(raw);
    if (tag) {
      known.add(tag);
      if (tag.toLowerCase() !== raw.trim().toLowerCase()) aliased[raw] = tag;
    } else {
      unknown.add(raw.trim());
    }
  }
  return { known: [...known].sort(), unknown: [...unknown].filter(Boolean).sort(), aliased };
}

/** 两个标签集合的 Jaccard 相似度（用于多样性降权） */
export function tagOverlap(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / (setA.size + setB.size - inter);
}

export function tagsByCategory(categoryId: string): string[] {
  return TAG_CATEGORIES.find((c) => c.id === categoryId)?.tags ?? [];
}
