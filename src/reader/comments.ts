/**
 * 评论区学习：只看公开章评/段评的「分布」，产出关注点与语气提示。
 * 铁律：不保存、不输出、不复制任何一条真实评论原文；输出里只有计数、比例和标签。
 */

export interface RawComment {
  /** 评论原文：只在本次调用内存里用于分类，绝不进入输出 */
  text: string;
  likes?: number;
  /** 段评：所在段落；章评可为空 */
  paragraphIndex?: number | null;
}

export interface CommentEvidence {
  total: number;
  /** 抽样的评论数（最多 limit 条） */
  sampled: number;
  paragraphCommentRatio: number;
  avgLength: number;
  /** 关注点计数（固定词表，不含原文） */
  concerns: Array<{ label: string; count: number }>;
  toneHints: string[];
  /** 数据是否可用（评论为空/抓不到时为 false） */
  available: boolean;
}

const CONCERNS: Array<{ label: string; keywords: string[] }> = [
  { label: "爽点", keywords: ["爽", "燃", "打脸", "解气", "上头"] },
  { label: "人物", keywords: ["人物", "角色", "人设", "性格", "男主", "女主"] },
  { label: "感情线", keywords: ["感情", "cp", "糖", "甜", "虐", "心动"] },
  { label: "节奏", keywords: ["节奏", "拖", "水", "快", "慢", "啰嗦"] },
  { label: "逻辑", keywords: ["逻辑", "bug", "矛盾", "不合理", "降智"] },
  { label: "伏笔", keywords: ["伏笔", "铺垫", "反转", "埋"] },
  { label: "文笔", keywords: ["文笔", "描写", "句子", "遣词"] },
  { label: "情绪", keywords: ["哭", "笑", "破防", "感动", "尬"] },
  { label: "弃书", keywords: ["弃", "看不下去", "撤退"] },
  { label: "更新", keywords: ["更新", "加更", "催更"] },
];

const TONE_HINTS: Array<{ label: string; keywords: string[] }> = [
  { label: "短评为主", keywords: [] },
  { label: "带梗吐槽", keywords: ["哈", "笑死", "狗头", "doge", "草"] },
  { label: "考据式长评", keywords: ["其实", "因为", "第", "伏笔"] },
  { label: "情绪化", keywords: ["啊", "！", "呜呜", "哭"] },
];

/**
 * @param comments 评论原文（只在函数内使用）
 * @param limit    最多抽样多少条（防止长篇书评区拖爆内存）
 */
export function distillCommentEvidence(comments: RawComment[], limit = 200): CommentEvidence {
  const sampled = comments.slice(0, Math.max(0, limit));
  if (sampled.length === 0) {
    return {
      total: comments.length,
      sampled: 0,
      paragraphCommentRatio: 0,
      avgLength: 0,
      concerns: [],
      toneHints: [],
      available: false,
    };
  }
  const paragraph = sampled.filter((c) => typeof c.paragraphIndex === "number" && c.paragraphIndex >= 0).length;
  const counts = new Map<string, number>();
  for (const comment of sampled) {
    const text = comment.text.toLowerCase();
    for (const concern of CONCERNS) {
      if (concern.keywords.some((k) => text.includes(k.toLowerCase()))) {
        counts.set(concern.label, (counts.get(concern.label) ?? 0) + 1);
      }
    }
  }
  const totalLen = sampled.reduce((sum, c) => sum + [...c.text].length, 0);
  const toneCounts = new Map<string, number>();
  for (const comment of sampled) {
    const text = comment.text.toLowerCase();
    for (const tone of TONE_HINTS) {
      if (tone.keywords.length === 0) continue;
      if (tone.keywords.some((k) => text.includes(k.toLowerCase()))) {
        toneCounts.set(tone.label, (toneCounts.get(tone.label) ?? 0) + 1);
      }
    }
  }
  const avgLength = totalLen / sampled.length;
  const toneHints: string[] = [];
  if (avgLength <= 20) toneHints.push("短评为主");
  for (const [label, count] of [...toneCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    if (count / sampled.length >= 0.15) toneHints.push(label);
  }
  return {
    total: comments.length,
    sampled: sampled.length,
    paragraphCommentRatio: paragraph / sampled.length,
    avgLength: Math.round(avgLength),
    concerns: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
    toneHints,
    available: true,
  };
}

/** 把评论分布翻译成给读者的「评论风格提示」——只描述倾向，不引用原文 */
export function commentStyleHints(evidence: CommentEvidence): string[] {
  if (!evidence.available) return [];
  const hints: string[] = [];
  if (evidence.paragraphCommentRatio >= 0.3) hints.push("真人爱在段落中途留评");
  if (evidence.avgLength <= 20) hints.push("评论偏短");
  if (evidence.avgLength >= 60) hints.push("评论偏长");
  const top = evidence.concerns[0];
  if (top) hints.push(`最关注：${top.label}`);
  for (const tone of evidence.toneHints) hints.push(`语气：${tone}`);
  return hints;
}
