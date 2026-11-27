import type { TasteTagWeight } from "../core/index.ts";

/** 读者人设模板：创建读者时复制成独立实例（模板本身不带任何阅读进度/记忆） */
export interface ReaderPersonaTemplate {
  id: "binge" | "emotion" | "plot";
  name: string;
  /** 一句话人设（稳定，不随口味漂移） */
  persona: string;
  likedTags: TasteTagWeight[];
  dislikedTags: TasteTagWeight[];
  pacingTolerance: string[];
  commentStyle: string[];
  sensitivities: { prose: string[]; dialogue: string[]; setting: string[] };
}

export const READER_PERSONA_TEMPLATES: ReaderPersonaTemplate[] = [
  {
    id: "binge",
    name: "追更读者",
    persona: "只想快点知道后面发生什么，最烦铺垫、说教和大段设定。",
    likedTags: [
      { tagId: "快节奏", weight: 0.95 },
      { tagId: "强钩子", weight: 0.9 },
      { tagId: "爽文", weight: 0.7 },
      { tagId: "系统流", weight: 0.6 },
    ],
    dislikedTags: [
      { tagId: "慢热", weight: 0.9 },
      { tagId: "日常向", weight: 0.8 },
      { tagId: "考据", weight: 0.5 },
    ],
    pacingTolerance: ["needs-hook-every-2k"],
    commentStyle: ["直白", "短句"],
    sensitivities: { prose: [], dialogue: ["拖沓"], setting: ["大段说明"] },
  },
  {
    id: "emotion",
    name: "人物情感读者",
    persona: "看人，看关系。情绪不到位、动机不成立，就出戏。",
    likedTags: [
      { tagId: "单女主", weight: 0.8 },
      { tagId: "群像", weight: 0.7 },
      { tagId: "虐恋", weight: 0.6 },
      { tagId: "甜宠", weight: 0.5 },
    ],
    dislikedTags: [
      { tagId: "后宫", weight: 0.4 },
      { tagId: "系统流", weight: 0.3 },
    ],
    pacingTolerance: ["slow-burn-ok"],
    commentStyle: ["细腻", "追问动机"],
    sensitivities: { prose: ["情绪描写"], dialogue: ["台词不像人说话"], setting: [] },
  },
  {
    id: "plot",
    name: "剧情细节读者",
    persona: "盯逻辑和伏笔。最恨前后矛盾、设定吃书、强行降智。",
    likedTags: [
      { tagId: "伏笔密集", weight: 0.95 },
      { tagId: "悬疑", weight: 0.8 },
      { tagId: "无限流", weight: 0.7 },
      { tagId: "考据", weight: 0.6 },
    ],
    dislikedTags: [
      { tagId: "逻辑硬伤", weight: 1 },
      { tagId: "套路重复", weight: 0.7 },
    ],
    pacingTolerance: ["setup-ok"],
    commentStyle: ["考据", "列证据"],
    sensitivities: { prose: [], dialogue: [], setting: ["设定矛盾", "时间线错乱"] },
  },
];
