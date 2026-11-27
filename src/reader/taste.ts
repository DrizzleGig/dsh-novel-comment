import type { TasteProfile, TasteTagWeight } from "../core/index.ts";
import { shortHash } from "./hash.ts";

export interface InitialTasteInput {
  readerId: string;
  likedTags?: TasteTagWeight[];
  dislikedTags?: TasteTagWeight[];
  likedAuthors?: string[];
  dislikedAuthors?: string[];
  likedTropes?: string[];
  dislikedTropes?: string[];
  pacingTolerance?: string[];
  commentStyle?: string[];
  sensitivities?: { prose?: string[]; dialogue?: string[]; setting?: string[] };
  now?: string;
}

/** 版本内容 = 除 version/parentVersion/updatedAt 以外的全部字段 */
export function tasteContentKey(t: Omit<TasteProfile, "version" | "parentVersion" | "updatedAt">): string {
  return JSON.stringify({
    readerId: t.readerId,
    likedTags: t.likedTags,
    dislikedTags: t.dislikedTags,
    likedAuthors: t.likedAuthors,
    dislikedAuthors: t.dislikedAuthors,
    likedTropes: t.likedTropes,
    dislikedTropes: t.dislikedTropes,
    pacingTolerance: t.pacingTolerance,
    sensitivities: t.sensitivities,
    commentStyle: t.commentStyle,
    evidenceRatingIds: t.evidenceRatingIds,
  });
}

export function computeTasteVersion(t: Omit<TasteProfile, "version" | "parentVersion" | "updatedAt">): string {
  return shortHash(tasteContentKey(t));
}

export function createInitialTaste(input: InitialTasteInput): TasteProfile {
  const now = input.now ?? new Date().toISOString();
  const base: Omit<TasteProfile, "version" | "parentVersion" | "updatedAt"> = {
    schemaVersion: 2,
    readerId: input.readerId,
    likedTags: dedupeTags(input.likedTags ?? []),
    dislikedTags: dedupeTags(input.dislikedTags ?? []),
    likedAuthors: dedupeStrings(input.likedAuthors ?? []),
    dislikedAuthors: dedupeStrings(input.dislikedAuthors ?? []),
    likedTropes: dedupeStrings(input.likedTropes ?? []),
    dislikedTropes: dedupeStrings(input.dislikedTropes ?? []),
    pacingTolerance: dedupeStrings(input.pacingTolerance ?? []),
    commentStyle: dedupeStrings(input.commentStyle ?? []),
    sensitivities: {
      prose: dedupeStrings(input.sensitivities?.prose ?? []),
      dialogue: dedupeStrings(input.sensitivities?.dialogue ?? []),
      setting: dedupeStrings(input.sensitivities?.setting ?? []),
    },
    evidenceRatingIds: [],
  };
  return { ...base, version: computeTasteVersion(base), parentVersion: null, updatedAt: now };
}

export type TastePatch = Partial<
  Pick<
    TasteProfile,
    | "likedTags"
    | "dislikedTags"
    | "likedAuthors"
    | "dislikedAuthors"
    | "likedTropes"
    | "dislikedTropes"
    | "pacingTolerance"
    | "commentStyle"
    | "sensitivities"
  >
>;

/**
 * 口味更新：生成新版本（不可变），parentVersion 指向旧版本。
 * 内容没变时返回原对象（不制造空版本）。
 */
export function updateTaste(current: TasteProfile, patch: TastePatch, evidenceRatingIds: string[] = [], now = new Date().toISOString()): TasteProfile {
  const nextBase: Omit<TasteProfile, "version" | "parentVersion" | "updatedAt"> = {
    schemaVersion: 2,
    readerId: current.readerId,
    likedTags: dedupeTags(patch.likedTags ?? current.likedTags),
    dislikedTags: dedupeTags(patch.dislikedTags ?? current.dislikedTags),
    likedAuthors: dedupeStrings(patch.likedAuthors ?? current.likedAuthors),
    dislikedAuthors: dedupeStrings(patch.dislikedAuthors ?? current.dislikedAuthors),
    likedTropes: dedupeStrings(patch.likedTropes ?? current.likedTropes),
    dislikedTropes: dedupeStrings(patch.dislikedTropes ?? current.dislikedTropes),
    pacingTolerance: dedupeStrings(patch.pacingTolerance ?? current.pacingTolerance),
    commentStyle: dedupeStrings(patch.commentStyle ?? current.commentStyle),
    sensitivities: {
      prose: dedupeStrings(patch.sensitivities?.prose ?? current.sensitivities.prose),
      dialogue: dedupeStrings(patch.sensitivities?.dialogue ?? current.sensitivities.dialogue),
      setting: dedupeStrings(patch.sensitivities?.setting ?? current.sensitivities.setting),
    },
    evidenceRatingIds: dedupeStrings([...current.evidenceRatingIds, ...evidenceRatingIds]),
  };
  if (tasteContentKey(nextBase) === tasteContentKey(current) && evidenceRatingIds.length === 0) return current;
  const version = shortHash(`${tasteContentKey(nextBase)}|${current.version}|${now}`);
  return { ...nextBase, version, parentVersion: current.version, updatedAt: now };
}

/** 权重必须在 0–1，且同一标签只留一个（合并取较大值） */
function dedupeTags(tags: TasteTagWeight[]): TasteTagWeight[] {
  const map = new Map<string, number>();
  for (const t of tags) {
    const w = Number.isFinite(t.weight) ? Math.min(1, Math.max(0, t.weight)) : 0;
    map.set(t.tagId, Math.max(w, map.get(t.tagId) ?? 0));
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([tagId, weight]) => ({ tagId, weight }));
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))].sort();
}
