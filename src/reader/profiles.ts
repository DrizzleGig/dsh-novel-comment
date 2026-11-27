import type { ReaderProfile } from "../core/index.ts";

/** 三种首批读者画像 — 与产品设计一致 */
export const PRESET_PROFILES: ReaderProfile[] = [
  {
    id: "binge",
    name: "追更读者",
    kind: "binge",
    preferences: ["节奏快", "有钩子", "章节末尾留悬念"],
    dislikes: ["大段设定说明", "拖沓日常"],
    readUpTo: null,
  },
  {
    id: "emotion",
    name: "人物情感读者",
    kind: "emotion",
    preferences: ["人物关系变化", "情绪张力", "角色魅力"],
    dislikes: ["人物行为无动机", "情感转折生硬"],
    readUpTo: null,
  },
  {
    id: "plot",
    name: "剧情细节读者",
    kind: "plot",
    preferences: ["伏笔回收", "逻辑自洽", "信息揭示节奏"],
    dislikes: ["前后矛盾", "突兀转折"],
    readUpTo: null,
  },
];

export function clonePresets(): ReaderProfile[] {
  return PRESET_PROFILES.map((p) => ({ ...p, preferences: [...p.preferences], dislikes: [...p.dislikes] }));
}
