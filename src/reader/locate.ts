import type { AnchorMatch, TextLocator } from "../core/index.ts";

/** 段落协议：空行分段（兼容 CRLF），段内保留单换行 */
export const PARAGRAPH_PROTOCOL = "blank-line-v1";

export interface LocatedAnchor {
  match: AnchorMatch;
  paragraphIndex: number;
  /** 段内偏移（未定位时为 null） */
  start: number | null;
  end: number | null;
}

export function splitParagraphs(text: string): string[] {
  const lf = text.replace(/\r\n?/g, "\n");
  return lf
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/\n+$/, ""))
    .filter((p) => p.length > 0);
}

interface MappedText {
  normalized: string;
  /** normalized 中第 i 个 UTF-16 单元 → 原文中的 [start,end) */
  spans: Array<{ start: number; end: number }>;
}

type SegmenterLike = { segment(input: string): Iterable<{ segment: string; index: number }> };

const segmenter: SegmenterLike | null = (() => {
  const S = (Intl as unknown as { Segmenter?: new (locale: string, opts: { granularity: string }) => SegmenterLike }).Segmenter;
  if (typeof S !== "function") return null;
  try {
    return new S("zh", { granularity: "grapheme" });
  } catch {
    return null;
  }
})();

function clustersOf(text: string): Array<{ segment: string; index: number }> {
  if (segmenter) return [...segmenter.segment(text)];
  return [...text].map((c, i) => ({ segment: c, index: i }));
}

/**
 * 受控规范化：只做 NFC 与「连续空白折叠」，不删标点、不做编辑距离。
 * spans 用来把匹配位置还原回原文。
 */
export function normalizeWithMap(text: string): MappedText {
  const lf = text.replace(/\r\n?/g, "\n");
  let normalized = "";
  const spans: MappedText["spans"] = [];
  let lastWasSpace = false;
  for (const cluster of clustersOf(lf)) {
    const start = cluster.index;
    const end = start + cluster.segment.length;
    if (/^[ \t\u3000]+$/.test(cluster.segment)) {
      if (lastWasSpace) continue;
      lastWasSpace = true;
      normalized += " ";
      spans.push({ start, end });
      continue;
    }
    lastWasSpace = false;
    const nfc = cluster.segment.normalize("NFC");
    normalized += nfc;
    for (let k = 0; k < nfc.length; k++) spans.push({ start, end });
  }
  return { normalized, spans };
}

function normalizeSpace(text: string): string {
  return text.replace(/\r\n?/g, "\n").normalize("NFC").replace(/[ \t\u3000]+/g, " ");
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + Math.max(1, needle.length);
  }
}

interface Candidate {
  start: number;
  end: number;
}

function disambiguate(paragraph: string, candidates: Candidate[], locator: TextLocator): Candidate[] {
  if (candidates.length <= 1) return candidates;
  const withContext = candidates.filter((c) => {
    const prefixOk = !locator.prefix || paragraph.slice(Math.max(0, c.start - locator.prefix.length), c.start) === locator.prefix;
    const suffixOk = !locator.suffix || paragraph.slice(c.end, c.end + locator.suffix.length) === locator.suffix;
    return prefixOk && suffixOk;
  });
  return withContext.length > 0 ? withContext : candidates;
}

/**
 * 在正文中定位一条引用。
 * 规则：只用「精确子串」与「受控规范化（NFC/空白）」；绝不用编辑距离或删标点制造匹配。
 * 同一段出现多处且上下文无法消歧 → ambiguous（UI 不跳到猜测位置）。
 */
export function locateAnchor(text: string, locator: TextLocator): LocatedAnchor {
  const paragraphs = splitParagraphs(text);
  const paragraph = paragraphs[locator.paragraphIndex];
  if (paragraph === undefined) return { match: "unmatched", paragraphIndex: locator.paragraphIndex, start: null, end: null };
  const quote = locator.quote;
  if (!quote) return { match: "unmatched", paragraphIndex: locator.paragraphIndex, start: null, end: null };

  // 1) 精确
  const exact: Candidate[] = [];
  for (let at = paragraph.indexOf(quote); at !== -1; at = paragraph.indexOf(quote, at + 1)) {
    exact.push({ start: at, end: at + quote.length });
  }
  if (exact.length > 0) {
    const pick = disambiguate(paragraph, exact, locator);
    if (pick.length === 1) return { match: "exact", paragraphIndex: locator.paragraphIndex, start: pick[0]!.start, end: pick[0]!.end };
    return { match: "ambiguous", paragraphIndex: locator.paragraphIndex, start: null, end: null };
  }

  // 2) 规范化匹配（NFC + 空白折叠）
  const mapped = normalizeWithMap(paragraph);
  const nQuote = normalizeSpace(quote);
  const candidates: Candidate[] = [];
  for (let at = mapped.normalized.indexOf(nQuote); at !== -1; at = mapped.normalized.indexOf(nQuote, at + 1)) {
    const first = mapped.spans[at];
    const last = mapped.spans[at + nQuote.length - 1];
    if (!first || !last) continue;
    candidates.push({ start: first.start, end: last.end });
  }
  if (candidates.length > 0) {
    const pick = disambiguate(paragraph, candidates, locator);
    if (pick.length === 1) return { match: "normalized", paragraphIndex: locator.paragraphIndex, start: pick[0]!.start, end: pick[0]!.end };
    return { match: "ambiguous", paragraphIndex: locator.paragraphIndex, start: null, end: null };
  }

  return { match: "unmatched", paragraphIndex: locator.paragraphIndex, start: null, end: null };
}

/** 从原文里为一段选中的文字构造 locator（供 UI 生成段评时用） */
export function buildLocator(text: string, paragraphIndex: number, start: number, end: number, quoteMax = 40): TextLocator | null {
  const paragraphs = splitParagraphs(text);
  const paragraph = paragraphs[paragraphIndex];
  if (paragraph === undefined || start < 0 || end <= start) return null;
  const selected = paragraph.slice(start, end);
  const quote = selected.length > quoteMax ? selected.slice(0, quoteMax) : selected;
  const prefix = paragraph.slice(Math.max(0, start - 10), start);
  const suffix = paragraph.slice(end, end + 10);
  return { paragraphIndex, quote, prefix, suffix };
}

/** 同一段里 quote 出现多次：提示这条段评会歧义 */
export function hasDuplicateQuote(text: string, locator: TextLocator): boolean {
  const paragraphs = splitParagraphs(text);
  const paragraph = paragraphs[locator.paragraphIndex];
  if (paragraph === undefined) return false;
  return countOccurrences(paragraph, locator.quote) > 1;
}
