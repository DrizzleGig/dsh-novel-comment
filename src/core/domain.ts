/**
 * 领域类型 — 与插件的数据目录一一对应。
 * 这里只定义「契约形状」，不实现存储；存储由各插件包自己负责。
 */

/** 插件名，与 npm 包 `dsh-novel-*` 的后缀一致 */
export type PluginName =
  | "kit"
  | "beat"
  | "fade"
  | "voice"
  | "fanfic"
  | "conductor"
  | "reader"
  | "image"
  | "persona"
  | "character"
  | "adult";

/** 每个插件独占的数据目录（相对用户工作区根） */
export const PLUGIN_DATA_DIR: Record<PluginName, string> = {
  kit: ".dsh-novel-kit",
  beat: ".dsh-novel-beat",
  fade: ".dsh-novel-fade",
  voice: ".dsh-novel-voice",
  fanfic: ".dsh-novel-fanfic",
  conductor: ".dsh-novel-conductor",
  reader: ".dsh-novel-comment",
  image: ".dsh-novel-image",
  persona: ".dsh-novel-persona",
  character: ".dsh-novel-character",
  adult: ".dsh-novel-adult",
};

/* ---------------------------------- reader --------------------------------- */

export type ReaderKind = "binge" | "emotion" | "plot" | "custom";

export interface ReaderProfile {
  id: string;
  name: string;
  kind: ReaderKind;
  /** 喜欢的叙事方式 */
  preferences: string[];
  /** 讨厌的套路 */
  dislikes: string[];
  /** 已读到的章节 */
  readUpTo: string | null;
}

export type FindingKind =
  | "experience"
  | "confusion"
  | "emotion"
  | "anticipation"
  | "fatigue";

export interface ReviewFinding {
  id: string;
  kind: FindingKind;
  /** 原文摘录 */
  excerpt: string;
  /** UTF-16 定位（可选） */
  anchor?: { start: number; end: number };
  note: string;
}

export interface ChapterReview {
  id: string;
  chapterId: string;
  profileId: string;
  /** 维度 -> 0..10 */
  scores: Record<string, number>;
  findings: ReviewFinding[];
  createdAt: string;
}

/* ---------------------------------- image ---------------------------------- */

export type AssetKind = "cover" | "portrait" | "scene";

export interface PromptTemplate {
  id: string;
  name: string;
  kind: AssetKind;
  template: string;
}

export interface AssetRecord {
  id: string;
  kind: AssetKind;
  /** 相对 .dsh-novel-image/ 的路径 */
  path: string;
  prompt: string;
  model?: string;
  characterId?: string;
  chapterId?: string;
  createdAt: string;
}

/* --------------------------------- persona --------------------------------- */

export type ConstraintScope = "author" | "protagonist" | "world";
export type ConstraintSeverity = "hard" | "soft";

export interface ConstraintRule {
  id: string;
  scope: ConstraintScope;
  rule: string;
  severity: ConstraintSeverity;
  enabled: boolean;
}

export interface ConstraintSnapshot {
  /** 单调递增；kit 导入时记录 importedFromPersonaVersion */
  revision: number;
  importedAt: string;
  rules: ConstraintRule[];
}

/* -------------------------------- character -------------------------------- */

export interface CharacterCard {
  id: string;
  name: string;
  /** 来源包与来源 id（一次性快照，不回溯） */
  sourcePkg?: string;
  sourceId?: string;
  importedAt: string;
  /** 角色卡正文（外貌、性格、说话方式） */
  persona: string;
}

export interface DialogueTurn {
  role: "user" | "character";
  text: string;
  at: string;
}

export interface DialogueSession {
  id: string;
  characterId: string;
  turns: DialogueTurn[];
  createdAt: string;
}

/* ---------------------------------- adult ---------------------------------- */

export type Grading = "general" | "mature" | "explicit";

export interface AdultPolicy {
  /** 默认关闭；开启才注入模板 */
  enabled: boolean;
  grading: Grading;
  /** 模型路由标识（例如 local:ollama / openai:xxx） */
  route: string;
  /** 模板槽位：system / style / tension */
  promptSlots: Record<string, string>;
}
