// src/adapter/storage.ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
var READER_DATA_DIR = ".dsh-novel-comment";
var FORMAT_FILE = "format.json";
var STORAGE_FORMAT = {
  schemaVersion: 2,
  storage: "reader-v2",
  textNormalization: "lf-v1",
  paragraphProtocol: "blank-line-v1"
};
var StorageError = class extends Error {
  file;
  constructor(file, message) {
    super(message);
    this.name = "StorageError";
    this.file = file;
  }
};
async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, content, "utf8");
  try {
    await rename(tmp, file);
  } catch (error) {
    await unlink(tmp).catch(() => void 0);
    throw error;
  }
}
async function writeJson(file, value) {
  await atomicWrite(file, `${JSON.stringify(value, null, 2)}
`);
}
async function readJsonOptional(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}
async function readJsonStrict(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new StorageError(file, `\u6587\u4EF6\u635F\u574F\uFF0C\u65E0\u6CD5\u89E3\u6790\uFF1A${file}\uFF08${error.message}\uFF09`);
  }
}
async function listJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  return names.filter((n) => n.endsWith(".json")).map((n) => path.join(dir, n)).sort();
}
function readerRoot(workspaceRoot) {
  return path.join(workspaceRoot, READER_DATA_DIR);
}
async function ensureLayout(workspaceRoot) {
  const root = readerRoot(workspaceRoot);
  await mkdir(path.join(root, "readers"), { recursive: true });
  await mkdir(path.join(root, "books"), { recursive: true });
  await mkdir(path.join(root, "quota"), { recursive: true });
  await mkdir(path.join(root, "reports"), { recursive: true });
  await mkdir(path.join(root, "exports"), { recursive: true });
  await mkdir(path.join(root, "locks"), { recursive: true });
  const formatFile = path.join(root, FORMAT_FILE);
  if (!existsSync(formatFile)) await writeJson(formatFile, STORAGE_FORMAT);
  return root;
}

// src/adapter/service.ts
import path3 from "node:path";
import { randomUUID as randomUUID2 } from "node:crypto";
import { mkdir as mkdir3, open, readFile as readFile3, unlink as unlink3 } from "node:fs/promises";
import { existsSync as existsSync3 } from "node:fs";
import { readdir as readdir3 } from "node:fs/promises";

// src/core/reader.ts
var DEFAULT_READER_LIMITS = { maxReaders: 8, hardMaxReaders: 16 };
var DEFAULT_GLOBAL_QUOTA = {
  newBooks: 3,
  chapters: 20,
  words: 6e4,
  tokens: 12e4
};
var DEFAULT_READER_QUOTA = {
  newBooks: 1,
  chapters: 5,
  words: 15e3,
  tokens: 3e4
};

// src/core/errors.ts
function ok(data) {
  return { ok: true, data };
}
function fail(code, message, details) {
  return { ok: false, error: { code, message, details } };
}

// src/reader/hash.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
function rotr(x, n) {
  return x >>> n | x << 32 - n;
}
function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const bitLen = bytes.length * 8;
  const withOne = bytes.length + 1;
  const paddedLen = withOne + (56 - withOne % 64 + 64) % 64;
  const buf = new Uint8Array(paddedLen + 8);
  buf.set(bytes);
  buf[bytes.length] = 128;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen, Math.floor(bitLen / 4294967296));
  view.setUint32(paddedLen + 4, bitLen >>> 0);
  let h0 = 1779033703;
  let h1 = 3144134277;
  let h2 = 1013904242;
  let h3 = 2773480762;
  let h4 = 1359893119;
  let h5 = 2600822924;
  let h6 = 528734635;
  let h7 = 1541459225;
  const w = new Uint32Array(64);
  for (let offset = 0; offset < buf.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const temp1 = h + S1 + ch + K[i] + w[i] >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const temp2 = S0 + maj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + temp1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2 >>> 0;
    }
    h0 = h0 + a >>> 0;
    h1 = h1 + b >>> 0;
    h2 = h2 + c >>> 0;
    h3 = h3 + d >>> 0;
    h4 = h4 + e >>> 0;
    h5 = h5 + f >>> 0;
    h6 = h6 + g >>> 0;
    h7 = h7 + h >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, "0")).join("");
}
function shortHash(text) {
  return sha256Hex(text).slice(0, 12);
}

// src/reader/ids.ts
var ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
var WINDOWS_RESERVED = /* @__PURE__ */ new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9"
]);
function isSafeId(id) {
  if (typeof id !== "string" || !ID_RE.test(id)) return false;
  return !WINDOWS_RESERVED.has(id);
}
function assertSafeId(id, label = "id") {
  if (!isSafeId(id)) {
    throw new Error(`\u975E\u6CD5 ${label}\uFF1A${JSON.stringify(id)}\uFF08\u53EA\u5141\u8BB8\u5C0F\u5199\u5B57\u6BCD/\u6570\u5B57/\u4E0B\u5212\u7EBF/\u77ED\u6A2A\uFF0C1\u201364 \u4F4D\uFF0C\u4E14\u4E0D\u80FD\u662F Windows \u4FDD\u7559\u540D\uFF09`);
  }
}
function slugify(input) {
  const ascii = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (ascii) return ascii;
  return `r-${shortHash(input)}`;
}

// src/reader/limits.ts
var ReaderLimitError = class extends Error {
  code;
  details;
  constructor(code, message, details) {
    super(message);
    this.name = "ReaderLimitError";
    this.code = code;
    this.details = details;
  }
};
function resolveReaderLimits(requested, defaults) {
  const hard = Math.max(1, Math.floor(defaults.hardMaxReaders));
  const base = requested ?? defaults.maxReaders;
  if (!Number.isFinite(base) || base < 1) {
    throw new ReaderLimitError("VALIDATION_FAILED", `\u8BFB\u8005\u4E0A\u9650\u5FC5\u987B\u662F >=1 \u7684\u6574\u6570\uFF0C\u6536\u5230 ${String(requested)}`);
  }
  const max = Math.min(Math.floor(base), hard);
  return { maxReaders: max, hardMaxReaders: hard };
}
function assertCanCreateReader(existingCount, limits) {
  if (existingCount >= limits.maxReaders) {
    throw new ReaderLimitError(
      "LIMIT_EXCEEDED",
      `\u8BFB\u8005\u6570\u91CF\u5DF2\u8FBE\u4E0A\u9650 ${limits.maxReaders}\uFF08\u786C\u4E0A\u9650 ${limits.hardMaxReaders}\uFF09`,
      { existingCount, maxReaders: limits.maxReaders, hardMaxReaders: limits.hardMaxReaders }
    );
  }
}
function checkQuota(limits, usage, delta) {
  const checks = [
    ["newBooks", usage.newBooks + (delta.newBooks ?? 0)],
    ["chapters", usage.chapters + (delta.chapters ?? 0)],
    ["words", usage.words + (delta.words ?? 0)],
    ["tokens", usage.tokens + (delta.tokens ?? 0)]
  ];
  for (const [key, next] of checks) {
    if (next > limits[key]) {
      return { ok: false, exceeded: key, message: `\u4ECA\u65E5 ${key} \u5DF2\u8FBE\u4E0A\u9650 ${limits[key]}\uFF08\u5F53\u524D ${usage[key]}\uFF09` };
    }
  }
  return { ok: true, exceeded: null };
}
function addUsage(usage, delta) {
  return {
    newBooks: usage.newBooks + (delta.newBooks ?? 0),
    chapters: usage.chapters + (delta.chapters ?? 0),
    words: usage.words + (delta.words ?? 0),
    tokens: usage.tokens + (typeof delta.tokens === "number" ? Math.max(0, Math.floor(delta.tokens)) : 0),
    unknownTokens: usage.unknownTokens + (delta.tokens === null ? 1 : 0)
  };
}
function emptyUsage() {
  return { newBooks: 0, chapters: 0, words: 0, tokens: 0, unknownTokens: 0 };
}

// src/reader/taste.ts
function tasteContentKey(t) {
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
    evidenceRatingIds: t.evidenceRatingIds
  });
}
function computeTasteVersion(t) {
  return shortHash(tasteContentKey(t));
}
function createInitialTaste(input) {
  const now = input.now ?? (/* @__PURE__ */ new Date()).toISOString();
  const base = {
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
      setting: dedupeStrings(input.sensitivities?.setting ?? [])
    },
    evidenceRatingIds: []
  };
  return { ...base, version: computeTasteVersion(base), parentVersion: null, updatedAt: now };
}
function updateTaste(current, patch, evidenceRatingIds = [], now = (/* @__PURE__ */ new Date()).toISOString()) {
  const nextBase = {
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
      setting: dedupeStrings(patch.sensitivities?.setting ?? current.sensitivities.setting)
    },
    evidenceRatingIds: dedupeStrings([...current.evidenceRatingIds, ...evidenceRatingIds])
  };
  if (tasteContentKey(nextBase) === tasteContentKey(current) && evidenceRatingIds.length === 0) return current;
  const version = shortHash(`${tasteContentKey(nextBase)}|${current.version}|${now}`);
  return { ...nextBase, version, parentVersion: current.version, updatedAt: now };
}
function dedupeTags(tags) {
  const map = /* @__PURE__ */ new Map();
  for (const t of tags) {
    const w = Number.isFinite(t.weight) ? Math.min(1, Math.max(0, t.weight)) : 0;
    map.set(t.tagId, Math.max(w, map.get(t.tagId) ?? 0));
  }
  return [...map.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([tagId, weight]) => ({ tagId, weight }));
}
function dedupeStrings(values) {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))].sort();
}

// src/reader/rating.ts
var MAX_CHAPTER_COMMENT = 200;
var MAX_SEGMENT_COMMENT = 100;
var MAX_SEGMENTS = 3;
var MAX_QUOTE = 200;
var MAX_CONTEXT = 10;
var RatingValidationError = class extends Error {
  field;
  constructor(field, message) {
    super(message);
    this.name = "RatingValidationError";
    this.field = field;
  }
};
var DROP_REASONS = [
  "slow_pacing",
  "character_break",
  "logic_error",
  "prose",
  "formulaic",
  "genre_mismatch",
  "other"
];
var STATUSES = ["follow", "watch", "drop"];
function validateStars(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new RatingValidationError("stars", `\u661F\u7EA7\u5FC5\u987B\u662F 1\u20135 \u7684\u6574\u6570\uFF0C\u6536\u5230 ${JSON.stringify(value)}`);
  }
  return value;
}
function validateStatus(value) {
  if (typeof value !== "string" || !STATUSES.includes(value)) {
    throw new RatingValidationError("status", `\u9605\u8BFB\u72B6\u6001\u5FC5\u987B\u662F ${STATUSES.join(" / ")} \u4E4B\u4E00\uFF0C\u6536\u5230 ${JSON.stringify(value)}`);
  }
  return value;
}
function validateDropReason(status, value) {
  if (status !== "drop") return void 0;
  if (typeof value !== "string" || !DROP_REASONS.includes(value)) {
    throw new RatingValidationError("dropReasonCode", `\u5F03\u4E66\u5FC5\u987B\u7ED9\u51FA\u539F\u56E0\u7801\uFF08${DROP_REASONS.join(" / ")}\uFF09\uFF0C\u6536\u5230 ${JSON.stringify(value)}`);
  }
  return value;
}
function cleanText(value, field, max, required) {
  if (typeof value !== "string") {
    if (required) throw new RatingValidationError(field, `${field} \u5FC5\u987B\u662F\u5B57\u7B26\u4E32`);
    return "";
  }
  const text = value.trim();
  if (required && text.length === 0) throw new RatingValidationError(field, `${field} \u4E0D\u80FD\u4E3A\u7A7A`);
  if (text.length > max) throw new RatingValidationError(field, `${field} \u8D85\u8FC7 ${max} \u5B57\u4E0A\u9650\uFF08\u5F53\u524D ${text.length}\uFF09`);
  return text;
}
function validateSegmentComments(value) {
  if (value === void 0 || value === null) return [];
  if (!Array.isArray(value)) throw new RatingValidationError("segmentComments", "\u6BB5\u8BC4\u5FC5\u987B\u662F\u6570\u7EC4");
  if (value.length > MAX_SEGMENTS) {
    throw new RatingValidationError("segmentComments", `\u6BB5\u8BC4\u6700\u591A ${MAX_SEGMENTS} \u6761\uFF08\u6536\u5230 ${value.length}\uFF09`);
  }
  return value.map((raw, index) => {
    const item = raw;
    if (!item || typeof item !== "object") throw new RatingValidationError(`segmentComments[${index}]`, "\u6BB5\u8BC4\u5FC5\u987B\u662F\u5BF9\u8C61");
    const locator = item.locator;
    if (!locator || typeof locator !== "object") throw new RatingValidationError(`segmentComments[${index}].locator`, "\u6BB5\u8BC4\u7F3A\u5C11 locator");
    if (!Number.isInteger(locator.paragraphIndex) || locator.paragraphIndex < 0) {
      throw new RatingValidationError(`segmentComments[${index}].locator.paragraphIndex`, "paragraphIndex \u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570");
    }
    const quote = cleanText(locator.quote, `segmentComments[${index}].locator.quote`, MAX_QUOTE, true);
    const prefix = cleanText(typeof locator.prefix === "string" ? locator.prefix : "", `segmentComments[${index}].locator.prefix`, MAX_CONTEXT, false);
    const suffix = cleanText(typeof locator.suffix === "string" ? locator.suffix : "", `segmentComments[${index}].locator.suffix`, MAX_CONTEXT, false);
    const excerpt = cleanText(item.excerpt, `segmentComments[${index}].excerpt`, MAX_QUOTE, true);
    const comment = cleanText(item.comment, `segmentComments[${index}].comment`, MAX_SEGMENT_COMMENT, true);
    return {
      locator: { paragraphIndex: locator.paragraphIndex, quote, prefix, suffix },
      excerpt,
      comment
    };
  });
}
function buildRating(draft) {
  const stars = validateStars(draft.stars);
  const status = validateStatus(draft.status);
  const dropReasonCode = validateDropReason(status, draft.dropReasonCode);
  const chapterComment = cleanText(draft.chapterComment, "chapterComment", MAX_CHAPTER_COMMENT, true);
  const segmentComments = validateSegmentComments(draft.segmentComments);
  const now = draft.now ?? (/* @__PURE__ */ new Date()).toISOString();
  const usage = draft.usage ?? { inputTokens: null, outputTokens: null, source: "unknown" };
  const seed = [
    draft.readerId,
    draft.target.bookId,
    draft.target.chapterId,
    draft.target.contentHash,
    draft.tasteVersion,
    stars,
    now,
    chapterComment
  ].join("|");
  return {
    schemaVersion: 2,
    id: `rating-${shortHash(seed)}`,
    readerId: draft.readerId,
    target: draft.target,
    stars,
    chapterComment,
    segmentComments,
    status,
    dropReasonCode,
    tasteVersion: draft.tasteVersion,
    model: draft.model,
    promptVersion: draft.promptVersion,
    usage,
    createdAt: now
  };
}

// src/reader/locate.ts
function splitParagraphs(text) {
  const lf = text.replace(/\r\n?/g, "\n");
  return lf.split(/\n[ \t]*\n/).map((p) => p.replace(/\n+$/, "")).filter((p) => p.length > 0);
}
var segmenter = (() => {
  const S = Intl.Segmenter;
  if (typeof S !== "function") return null;
  try {
    return new S("zh", { granularity: "grapheme" });
  } catch {
    return null;
  }
})();
function clustersOf(text) {
  if (segmenter) return [...segmenter.segment(text)];
  return [...text].map((c, i) => ({ segment: c, index: i }));
}
function normalizeWithMap(text) {
  const lf = text.replace(/\r\n?/g, "\n");
  let normalized = "";
  const spans = [];
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
function normalizeSpace(text) {
  return text.replace(/\r\n?/g, "\n").normalize("NFC").replace(/[ \t\u3000]+/g, " ");
}
function disambiguate(paragraph, candidates, locator) {
  if (candidates.length <= 1) return candidates;
  const withContext = candidates.filter((c) => {
    const prefixOk = !locator.prefix || paragraph.slice(Math.max(0, c.start - locator.prefix.length), c.start) === locator.prefix;
    const suffixOk = !locator.suffix || paragraph.slice(c.end, c.end + locator.suffix.length) === locator.suffix;
    return prefixOk && suffixOk;
  });
  return withContext.length > 0 ? withContext : candidates;
}
function locateAnchor(text, locator) {
  const paragraphs = splitParagraphs(text);
  const paragraph = paragraphs[locator.paragraphIndex];
  if (paragraph === void 0) return { match: "unmatched", paragraphIndex: locator.paragraphIndex, start: null, end: null };
  const quote = locator.quote;
  if (!quote) return { match: "unmatched", paragraphIndex: locator.paragraphIndex, start: null, end: null };
  const exact = [];
  for (let at = paragraph.indexOf(quote); at !== -1; at = paragraph.indexOf(quote, at + 1)) {
    exact.push({ start: at, end: at + quote.length });
  }
  if (exact.length > 0) {
    const pick = disambiguate(paragraph, exact, locator);
    if (pick.length === 1) return { match: "exact", paragraphIndex: locator.paragraphIndex, start: pick[0].start, end: pick[0].end };
    return { match: "ambiguous", paragraphIndex: locator.paragraphIndex, start: null, end: null };
  }
  const mapped = normalizeWithMap(paragraph);
  const nQuote = normalizeSpace(quote);
  const candidates = [];
  for (let at = mapped.normalized.indexOf(nQuote); at !== -1; at = mapped.normalized.indexOf(nQuote, at + 1)) {
    const first = mapped.spans[at];
    const last = mapped.spans[at + nQuote.length - 1];
    if (!first || !last) continue;
    candidates.push({ start: first.start, end: last.end });
  }
  if (candidates.length > 0) {
    const pick = disambiguate(paragraph, candidates, locator);
    if (pick.length === 1) return { match: "normalized", paragraphIndex: locator.paragraphIndex, start: pick[0].start, end: pick[0].end };
    return { match: "ambiguous", paragraphIndex: locator.paragraphIndex, start: null, end: null };
  }
  return { match: "unmatched", paragraphIndex: locator.paragraphIndex, start: null, end: null };
}

// src/reader/valley.ts
var DEFAULT_PEAK_WINDOWS = [
  { weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "12:00", label: "\u5DE5\u4F5C\u65E5\u4E0A\u5348\u9AD8\u5CF0" },
  { weekdays: [1, 2, 3, 4, 5], start: "14:00", end: "18:00", label: "\u5DE5\u4F5C\u65E5\u4E0B\u5348\u9AD8\u5CF0" }
];
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) throw new Error(`\u975E\u6CD5\u65F6\u95F4\uFF1A${hhmm}`);
  return h * 60 + m;
}
function isPeak(moment, windows = DEFAULT_PEAK_WINDOWS) {
  const minutes = moment.hour * 60 + moment.minute;
  return windows.some((w) => {
    if (!w.weekdays.includes(moment.weekday)) return false;
    const start = toMinutes(w.start);
    const end = toMinutes(w.end);
    if (start <= end) return minutes >= start && minutes < end;
    return minutes >= start || minutes < end;
  });
}
function classifyMoment(moment, windows = DEFAULT_PEAK_WINDOWS) {
  return isPeak(moment, windows) ? "peak" : "valley";
}
function momentFromDate(date, tzOffsetMinutes) {
  const shifted = new Date(date.getTime() + tzOffsetMinutes * 6e4);
  const jsDay = shifted.getUTCDay();
  const weekday = jsDay === 0 ? 7 : jsDay;
  return { weekday, hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() };
}

// src/reader/reading.ts
var ReadingOrderError = class extends Error {
  expectedSequence;
  actualSequence;
  constructor(message, expectedSequence, actualSequence) {
    super(message);
    this.name = "ReadingOrderError";
    this.expectedSequence = expectedSequence;
    this.actualSequence = actualSequence;
  }
};
function assertNextReadingChapter(readThrough, targetSequence) {
  if (!Number.isInteger(targetSequence) || targetSequence < 1) {
    throw new ReadingOrderError(`\u7AE0\u8282\u5E8F\u53F7\u5FC5\u987B\u662F >=1 \u7684\u6574\u6570\uFF0C\u6536\u5230 ${targetSequence}`, readThrough + 1, targetSequence);
  }
  const expected = readThrough + 1;
  if (targetSequence !== expected) {
    throw new ReadingOrderError(
      `\u8BFB\u8005\u5F53\u524D\u8BFB\u5230\u7B2C ${readThrough} \u7AE0\uFF0C\u53EA\u80FD\u63A5\u7740\u8BFB\u7B2C ${expected} \u7AE0\uFF08\u8BF7\u6C42\u7684\u662F\u7B2C ${targetSequence} \u7AE0\uFF09`,
      expected,
      targetSequence
    );
  }
}
function assertReviewOrder(memory, targetChapterNumber, generation) {
  if (!Number.isInteger(targetChapterNumber) || targetChapterNumber < 1) {
    throw new ReadingOrderError(`\u7AE0\u8282\u53F7\u5FC5\u987B\u662F >=1 \u7684\u6574\u6570\uFF0C\u6536\u5230 ${targetChapterNumber}`, 1, targetChapterNumber);
  }
  if (targetChapterNumber === 1) return;
  if (!memory) {
    throw new ReadingOrderError(`\u8FD8\u6CA1\u6709\u8BC4\u5BA1\u94FE\u8BB0\u5FC6\uFF0C\u4E0D\u80FD\u76F4\u63A5\u8BC4\u5BA1\u7B2C ${targetChapterNumber} \u7AE0`, 1, targetChapterNumber);
  }
  if (memory.generation !== generation) {
    throw new ReadingOrderError(`\u8BC4\u5BA1\u94FE\u5DF2\u6362\u4EE3\uFF08memory generation=${memory.generation}\uFF0C\u8BF7\u6C42=${generation}\uFF09\uFF0C\u9700\u8981\u91CD\u8BFB`, 1, targetChapterNumber);
  }
  const expected = memory.validThrough + 1;
  if (targetChapterNumber !== expected) {
    throw new ReadingOrderError(
      `\u8BC4\u5BA1\u94FE\u6709\u6548\u8BFB\u5230\u7B2C ${memory.validThrough} \u7AE0\uFF0C\u53EA\u80FD\u8BC4\u7B2C ${expected} \u7AE0\uFF08\u8BF7\u6C42\u7684\u662F\u7B2C ${targetChapterNumber} \u7AE0\uFF09`,
      expected,
      targetChapterNumber
    );
  }
}
function nextFatigue(previous, stars) {
  const base = Math.max(0, Math.min(20, Math.floor(previous)));
  return stars <= 3 ? Math.min(20, base + 1) : 0;
}
function emptyReadingMemory(readerId, bookId, now = (/* @__PURE__ */ new Date()).toISOString()) {
  return {
    schemaVersion: 2,
    id: `mem-${readerId}-${bookId}`,
    readerId,
    bookId,
    readThrough: 0,
    characters: [],
    expectations: [],
    emotionalTone: "",
    unreadQuestions: [],
    fatigueCounter: 0,
    droppedReason: null,
    updatedAt: now
  };
}

// src/reader/comparison.ts
function compareRatings(input) {
  const rows = input.items.map((item) => ({
    readerId: item.readerId,
    readerName: item.readerName,
    stars: item.stars,
    revision: item.revision ?? input.targetRevision,
    chapterComment: item.chapterComment,
    segmentComments: item.segmentComments.length,
    tasteVersion: item.tasteVersion
  })).sort((a, b) => b.stars - a.stars || (a.readerId < b.readerId ? -1 : 1));
  const readerCount = new Set(rows.map((r) => r.readerId)).size;
  const revisionCount = new Set(rows.map((r) => r.revision)).size;
  const tasteByReader = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const set = tasteByReader.get(row.readerId) ?? /* @__PURE__ */ new Set();
    set.add(row.tasteVersion);
    tasteByReader.set(row.readerId, set);
  }
  const readerTasteChanged = [...tasteByReader.values()].some((set) => set.size > 1);
  const spread = rows.length > 0 ? Math.max(...rows.map((r) => r.stars)) - Math.min(...rows.map((r) => r.stars)) : 0;
  const notes = [];
  if (rows.length < 2) {
    return { attribution: "incomparable", rows, spread, notes: ["\u81F3\u5C11\u9700\u8981\u4E24\u6761\u8BC4\u5206\u624D\u80FD\u6BD4\u8F83"] };
  }
  let attribution;
  if (readerCount > 1 && revisionCount === 1) {
    attribution = "taste_difference";
    notes.push("\u540C\u4E00\u7AE0\u3001\u540C\u4E00\u7A3F\u4EF6\u7248\u672C\u3001\u4E0D\u540C\u8BFB\u8005\uFF1A\u5206\u5DEE\u6765\u81EA\u53E3\u5473\u5DEE\u5F02");
  } else if (readerCount === 1 && revisionCount > 1) {
    if (readerTasteChanged) {
      attribution = "mixed_change";
      notes.push("\u540C\u4E00\u8BFB\u8005\u3001\u4E0D\u540C\u7A3F\u4EF6\u7248\u672C\uFF0C\u4F46\u53E3\u5473\u7248\u672C\u4E5F\u53D8\u4E86\uFF1A\u6807\u4E3A\u6DF7\u5408\u53D8\u5316\uFF0C\u4E0D\u80FD\u5355\u72EC\u5F52\u56E0");
    } else {
      attribution = "manuscript_change";
      notes.push("\u540C\u4E00\u8BFB\u8005\u3001\u540C\u4E00\u53E3\u5473\u7248\u672C\u3001\u4E0D\u540C\u7A3F\u4EF6\u7248\u672C\uFF1A\u5206\u5DEE\u6765\u81EA\u7A3F\u4EF6\u53D8\u5316");
    }
  } else if (readerCount > 1 && revisionCount > 1) {
    attribution = "mixed_change";
    notes.push("\u8BFB\u8005\u4E0E\u7A3F\u4EF6\u90FD\u53D8\u4E86\uFF1A\u6807\u4E3A\u6DF7\u5408\u53D8\u5316\uFF0C\u4E0D\u80FD\u5355\u72EC\u5F52\u56E0");
  } else {
    attribution = "incomparable";
    notes.push("\u540C\u4E00\u8BFB\u8005\u3001\u540C\u4E00\u7248\u672C\u53EA\u6709\u4E00\u6761\u8BC4\u5206\uFF0C\u6CA1\u6709\u53EF\u6BD4\u5BF9\u8C61");
  }
  if (spread >= 2) {
    notes.push(`\u661F\u7EA7\u6781\u5DEE ${spread} \u661F\uFF0C\u5C5E\u4E8E\u660E\u663E\u5206\u6B67\uFF0C\u503C\u5F97\u770B\u4E24\u8FB9\u6BB5\u8BC4`);
  }
  return { attribution, rows, spread, notes };
}

// src/reader/report.ts
var DROP_REASON_TEXT = {
  slow_pacing: "\u8282\u594F\u6162",
  character_break: "\u4EBA\u8BBE\u5D29",
  logic_error: "\u903B\u8F91\u786C\u4F24",
  prose: "\u6587\u7B14",
  formulaic: "\u5957\u8DEF\u91CD\u590D",
  genre_mismatch: "\u9898\u6750\u4E0D\u5408",
  other: "\u5176\u4ED6"
};
function renderDailyReport(date, entries, skipped = []) {
  const lines = [];
  lines.push(`# \u8BFB\u8005\u65E5\u62A5 \u2014 ${date}`);
  lines.push("");
  const chapterTotal = entries.reduce((sum, e) => sum + e.readToChapter, 0);
  lines.push(`\u4ECA\u5929\u8BFB\u4E86 ${entries.length} \u672C\u3001\u5171 ${chapterTotal} \u7AE0\u3002`);
  lines.push("");
  for (const entry of entries) {
    lines.push(`### ${entry.bookId}`);
    lines.push("");
    lines.push(`- \u4E66\u540D\uFF1A${entry.title}${entry.author ? `\uFF08${entry.author}\uFF09` : ""}`);
    lines.push(`- \u8BFB\u5230\uFF1A\u7B2C ${entry.readToChapter} \u7AE0${entry.totalChapters ? ` / \u5171 ${entry.totalChapters} \u7AE0` : ""}`);
    const statusText = entry.status === "follow" ? "\u8FFD\u66F4" : entry.status === "watch" ? "\u89C2\u671B" : "\u5F03\u4E66";
    lines.push(`- \u8BC4\u5206\uFF1A${entry.stars} \u661F\uFF08${statusText}\uFF09`);
    if (entry.segmentComments) lines.push(`- \u6BB5\u8BC4\uFF1A${entry.segmentComments} \u6761`);
    if (entry.dropReasonCode) lines.push(`- \u5F03\u4E66\u539F\u56E0\uFF1A${DROP_REASON_TEXT[entry.dropReasonCode]}`);
    lines.push(`- \u4E00\u53E5\u8BDD\uFF1A${entry.note}`);
    lines.push("");
  }
  if (skipped.length > 0) {
    lines.push("## \u8DF3\u8FC7");
    lines.push("");
    for (const s of skipped) {
      lines.push(`- ${s.bookId ? `${s.bookId}\uFF1A` : ""}${s.reason}${s.detail ? `\uFF08${s.detail}\uFF09` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// src/reader/personas.ts
var READER_PERSONA_TEMPLATES = [
  {
    id: "binge",
    name: "\u8FFD\u66F4\u8BFB\u8005",
    persona: "\u53EA\u60F3\u5FEB\u70B9\u77E5\u9053\u540E\u9762\u53D1\u751F\u4EC0\u4E48\uFF0C\u6700\u70E6\u94FA\u57AB\u3001\u8BF4\u6559\u548C\u5927\u6BB5\u8BBE\u5B9A\u3002",
    likedTags: [
      { tagId: "\u5FEB\u8282\u594F", weight: 0.95 },
      { tagId: "\u5F3A\u94A9\u5B50", weight: 0.9 },
      { tagId: "\u723D\u6587", weight: 0.7 },
      { tagId: "\u7CFB\u7EDF\u6D41", weight: 0.6 }
    ],
    dislikedTags: [
      { tagId: "\u6162\u70ED", weight: 0.9 },
      { tagId: "\u65E5\u5E38\u5411", weight: 0.8 },
      { tagId: "\u8003\u636E", weight: 0.5 }
    ],
    pacingTolerance: ["needs-hook-every-2k"],
    commentStyle: ["\u76F4\u767D", "\u77ED\u53E5"],
    sensitivities: { prose: [], dialogue: ["\u62D6\u6C93"], setting: ["\u5927\u6BB5\u8BF4\u660E"] }
  },
  {
    id: "emotion",
    name: "\u4EBA\u7269\u60C5\u611F\u8BFB\u8005",
    persona: "\u770B\u4EBA\uFF0C\u770B\u5173\u7CFB\u3002\u60C5\u7EEA\u4E0D\u5230\u4F4D\u3001\u52A8\u673A\u4E0D\u6210\u7ACB\uFF0C\u5C31\u51FA\u620F\u3002",
    likedTags: [
      { tagId: "\u5355\u5973\u4E3B", weight: 0.8 },
      { tagId: "\u7FA4\u50CF", weight: 0.7 },
      { tagId: "\u8650\u604B", weight: 0.6 },
      { tagId: "\u751C\u5BA0", weight: 0.5 }
    ],
    dislikedTags: [
      { tagId: "\u540E\u5BAB", weight: 0.4 },
      { tagId: "\u7CFB\u7EDF\u6D41", weight: 0.3 }
    ],
    pacingTolerance: ["slow-burn-ok"],
    commentStyle: ["\u7EC6\u817B", "\u8FFD\u95EE\u52A8\u673A"],
    sensitivities: { prose: ["\u60C5\u7EEA\u63CF\u5199"], dialogue: ["\u53F0\u8BCD\u4E0D\u50CF\u4EBA\u8BF4\u8BDD"], setting: [] }
  },
  {
    id: "plot",
    name: "\u5267\u60C5\u7EC6\u8282\u8BFB\u8005",
    persona: "\u76EF\u903B\u8F91\u548C\u4F0F\u7B14\u3002\u6700\u6068\u524D\u540E\u77DB\u76FE\u3001\u8BBE\u5B9A\u5403\u4E66\u3001\u5F3A\u884C\u964D\u667A\u3002",
    likedTags: [
      { tagId: "\u4F0F\u7B14\u5BC6\u96C6", weight: 0.95 },
      { tagId: "\u60AC\u7591", weight: 0.8 },
      { tagId: "\u65E0\u9650\u6D41", weight: 0.7 },
      { tagId: "\u8003\u636E", weight: 0.6 }
    ],
    dislikedTags: [
      { tagId: "\u903B\u8F91\u786C\u4F24", weight: 1 },
      { tagId: "\u5957\u8DEF\u91CD\u590D", weight: 0.7 }
    ],
    pacingTolerance: ["setup-ok"],
    commentStyle: ["\u8003\u636E", "\u5217\u8BC1\u636E"],
    sensitivities: { prose: [], dialogue: [], setting: ["\u8BBE\u5B9A\u77DB\u76FE", "\u65F6\u95F4\u7EBF\u9519\u4E71"] }
  }
];

// src/reader/fake.ts
function fakeReview(input) {
  const paragraphs = splitParagraphs(input.content);
  const seed = hash32(`${input.reader.id}|${input.bookId}|${input.chapterId}|${input.revision}|${input.contentHash}`);
  const stars = 1 + seed % 5;
  const first = paragraphs[0] ?? "";
  const quote = [...first].slice(0, 24).join("");
  const segmentComments = quote.length > 0 ? [
    {
      locator: { paragraphIndex: 0, quote, prefix: "", suffix: "" },
      excerpt: quote,
      comment: stars >= 4 ? "\u8FD9\u6BB5\u6709\u753B\u9762\uFF0C\u613F\u610F\u5F80\u4E0B\u770B\u3002" : "\u8FD9\u6BB5\u4FE1\u606F\u91CF\u504F\u4F4E\uFF0C\u5BB9\u6613\u8D70\u795E\u3002"
    }
  ] : [];
  const status = stars >= 4 ? "follow" : stars === 3 ? "watch" : "drop";
  return buildRating({
    readerId: input.reader.id,
    target: {
      kind: "manuscript",
      bookId: input.bookId,
      chapterId: input.chapterId,
      contentHash: input.contentHash,
      chapterNumber: 1,
      revision: input.revision
    },
    stars,
    chapterComment: `\uFF08\u6A21\u62DF\uFF09${stars >= 4 ? "\u8FD9\u4E00\u7AE0\u6709\u94A9\u5B50\uFF0C\u60F3\u77E5\u9053\u540E\u9762\u600E\u4E48\u8D70\u3002" : stars === 3 ? "\u80FD\u770B\uFF0C\u4F46\u8FD8\u6CA1\u6293\u4F4F\u6211\u3002" : "\u8282\u594F\u548C\u4EBA\u7269\u90FD\u6CA1\u7ACB\u4F4F\uFF0C\u6211\u4F1A\u5F03\u3002"}`,
    segmentComments,
    status,
    dropReasonCode: status === "drop" ? "slow_pacing" : void 0,
    tasteVersion: input.taste.version,
    model: "fake-reader",
    promptVersion: "fake-v1",
    usage: { inputTokens: null, outputTokens: null, source: "unknown" },
    now: input.now
  });
}
function hash32(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

// src/reader/tags.ts
var TAG_CATEGORIES = [
  {
    id: "world",
    label: "\u9898\u6750 / \u4E16\u754C\u89C2",
    tags: ["\u90FD\u5E02", "\u4ED9\u4FA0", "\u7384\u5E7B", "\u5947\u5E7B", "\u79D1\u5E7B", "\u672B\u4E16", "\u5386\u53F2", "\u6B66\u4FA0", "\u60AC\u7591", "\u7075\u5F02", "\u6E38\u620F", "\u7535\u7ADE", "\u6821\u56ED", "\u804C\u573A", "\u5A31\u4E50\u5708", "\u5E74\u4EE3", "\u519B\u4E8B", "\u4F53\u80B2", "\u8D5B\u535A", "\u514B\u82CF\u9C81", "\u7075\u6C14\u590D\u82CF"]
  },
  {
    id: "plot",
    label: "\u5267\u60C5\u673A\u5236",
    tags: ["\u7CFB\u7EDF\u6D41", "\u7A7F\u8D8A", "\u91CD\u751F", "\u7A7F\u4E66", "\u5FEB\u7A7F", "\u65E0\u9650\u6D41", "\u8BF8\u5929\u4E07\u754C", "\u7B7E\u5230\u6D41", "\u76F4\u64AD\u6D41", "\u79CD\u7530", "\u7ECF\u8425", "\u590D\u4EC7", "\u63A2\u6848", "\u5347\u7EA7", "\u65E0\u654C\u6D41", "\u626E\u732A\u5403\u864E", "\u5E9F\u67F4\u9006\u88AD", "\u9F99\u50B2\u5929", "\u7FA4\u50CF\u5192\u9669", "\u5355\u5143\u5267"]
  },
  {
    id: "romance",
    label: "\u611F\u60C5\u7ED3\u6784\u4E0E\u89D2\u8272",
    tags: ["\u5355\u5973\u4E3B", "\u591A\u5973\u4E3B", "\u540E\u5BAB", "\u65E0 CP", "\u53CC\u5F3A", "\u7FA4\u50CF", "\u5E08\u5F92", "\u9752\u6885\u7AF9\u9A6C", "\u5148\u5A5A\u540E\u7231", "\u8FFD\u59BB\u706B\u846C\u573A", "\u7834\u955C\u91CD\u5706", "\u6697\u604B", "\u751C\u5BA0", "\u8650\u604B", "\u5BAB\u6597", "\u5B85\u6597", "\u8C6A\u95E8"]
  },
  {
    id: "pace",
    label: "\u8282\u594F\u4E0E\u7ED3\u6784",
    tags: ["\u5FEB\u8282\u594F", "\u6162\u70ED", "\u5F3A\u94A9\u5B50", "\u65E5\u5E38\u5411", "\u4E3B\u7EBF\u63A8\u8FDB", "\u4F0F\u7B14\u5BC6\u96C6", "\u77ED\u5E73\u5FEB", "\u957F\u7BC7\u94FA\u9648"]
  },
  {
    id: "style",
    label: "\u8BED\u6C14\u4E0E\u98CE\u683C",
    tags: ["\u723D\u6587", "\u8F7B\u677E\u641E\u7B11", "\u6E29\u99A8\u6CBB\u6108", "\u6697\u9ED1\u538B\u6291", "\u4E25\u8083", "\u8003\u636E", "\u5BF9\u767D\u5BC6\u96C6", "\u63CF\u5199\u7EC6\u817B", "\u7B2C\u4E00\u4EBA\u79F0", "\u591A\u89C6\u89D2"]
  },
  {
    id: "boundary",
    label: "\u5185\u5BB9\u8FB9\u754C\uFF08\u53EA\u4F5C\u504F\u597D\uFF0C\u4E0D\u4F5C\u98CE\u8BC4\uFF09",
    tags: ["\u4E3B\u89D2\u6027\u522B", "\u611F\u60C5\u7EBF\u6709\u65E0", "\u66B4\u529B\u7A0B\u5EA6", "\u60B2\u5267\u7ED3\u5C40", "\u7CFB\u7EDF\u662F\u5426\u62DF\u4EBA", "\u662F\u5426\u8650\u4E3B", "\u70C2\u5C3E\u9884\u8B66"]
  }
];
var TAG_ALIASES = {
  \u672B\u65E5: "\u672B\u4E16",
  \u60CA\u609A: "\u7075\u5F02",
  \u8D5B\u535A\u670B\u514B: "\u8D5B\u535A",
  \u7CFB\u7EDF\u6587: "\u7CFB\u7EDF\u6D41",
  \u9762\u677F\u6D41: "\u7CFB\u7EDF\u6D41",
  \u9B42\u7A7F: "\u7A7F\u8D8A",
  \u8EAB\u7A7F: "\u7A7F\u8D8A",
  \u8F6E\u56DE\u6D41: "\u65E0\u9650\u6D41",
  \u526F\u672C\u6D41: "\u65E0\u9650\u6D41",
  \u78BE\u538B\u6D41: "\u65E0\u654C\u6D41",
  \u85CF\u62D9: "\u626E\u732A\u5403\u864E",
  \u4F4E\u8C03\u6D41: "\u626E\u732A\u5403\u864E",
  "1v1": "\u5355\u5973\u4E3B",
  \u5BA0\u6587: "\u751C\u5BA0",
  \u5973\u5F3A: "\u53CC\u5F3A",
  \u7537\u5F3A: "\u53CC\u5F3A",
  \u723D: "\u723D\u6587",
  \u641E\u7B11: "\u8F7B\u677E\u641E\u7B11",
  \u6CBB\u6108: "\u6E29\u99A8\u6CBB\u6108",
  \u9ED1\u6697: "\u6697\u9ED1\u538B\u6291"
};
function tagCatalog() {
  return {
    categories: TAG_CATEGORIES.map((c) => ({ ...c, tags: [...c.tags] })),
    aliases: { ...TAG_ALIASES }
  };
}
function resolveTag(input) {
  const raw = String(input ?? "").trim();
  const canonical = canonicalTag(raw);
  return canonical ? { tag: canonical, known: true } : { tag: raw, known: false };
}
var ALL_TAGS = TAG_CATEGORIES.flatMap((c) => c.tags);
var TAG_BY_LOWER = new Map(ALL_TAGS.map((t) => [t.toLowerCase(), t]));
function canonicalTag(input) {
  const key = input.trim().toLowerCase();
  if (!key) return null;
  const aliased = TAG_ALIASES[key];
  if (aliased) return aliased;
  return TAG_BY_LOWER.get(key) ?? null;
}
function normalizeTags(tags) {
  const known = /* @__PURE__ */ new Set();
  const unknown = /* @__PURE__ */ new Set();
  const aliased = {};
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
function tagOverlap(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / (setA.size + setB.size - inter);
}
function tagsByCategory(categoryId) {
  return TAG_CATEGORIES.find((c) => c.id === categoryId)?.tags ?? [];
}

// src/reader/discover.ts
function rankCandidates(taste, candidates, options = {}) {
  const excludeIds = new Set(options.excludeBookIds ?? []);
  const excludeAuthors = new Set((options.excludeAuthors ?? []).map((a) => a.trim()).filter(Boolean));
  const liked = new Map(taste.likedTags.map((t) => [t.tagId, t.weight]));
  const disliked = new Map(taste.dislikedTags.map((t) => [t.tagId, t.weight]));
  const likedAuthors = new Set(taste.likedAuthors ?? []);
  const dislikedAuthors = new Set(taste.dislikedAuthors ?? []);
  const scored = candidates.filter((book) => !excludeIds.has(book.bookId)).filter((book) => !book.author || !excludeAuthors.has(book.author)).map((book) => {
    let score = 0;
    const matchedTags = [];
    const hitDislikedTags = [];
    for (const tag of book.tags) {
      const likeWeight = liked.get(tag);
      if (likeWeight !== void 0) {
        score += likeWeight;
        matchedTags.push(tag);
      }
      const dislikeWeight = disliked.get(tag);
      if (dislikeWeight !== void 0) {
        score -= dislikeWeight * 2;
        hitDislikedTags.push(tag);
      }
    }
    if (book.author && likedAuthors.has(book.author)) score += 0.5;
    if (book.author && dislikedAuthors.has(book.author)) score -= 1;
    return { book, score, matchedTags, hitDislikedTags, reason: "" };
  }).filter((item) => item.hitDislikedTags.length === 0).sort((a, b) => b.score - a.score || a.book.bookId.localeCompare(b.book.bookId));
  const picked = [];
  const pool = [...scored];
  const sameAuthorPenalty = options.sameAuthorPenalty ?? 0.35;
  const similarTagPenalty = options.similarTagPenalty ?? 0.5;
  while (pool.length > 0 && picked.length < (options.limit ?? 3)) {
    let bestIndex = 0;
    let bestAdjusted = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i];
      let adjusted = item.score;
      for (const chosen2 of picked) {
        if (item.book.author && chosen2.book.author && item.book.author === chosen2.book.author) adjusted -= sameAuthorPenalty;
        adjusted -= similarTagPenalty * tagOverlap(item.book.tags, chosen2.book.tags);
      }
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIndex = i;
      }
    }
    const [chosen] = pool.splice(bestIndex, 1);
    if (!chosen) break;
    picked.push({ ...chosen, reason: describe(chosen) });
  }
  return picked;
}
function describe(item) {
  const parts = [];
  if (item.matchedTags.length > 0) parts.push(`\u5BF9\u53E3\u5473\uFF1A${item.matchedTags.join("\u3001")}`);
  if (item.hitDislikedTags.length > 0) parts.push(`\u542B\u96F7\u70B9\uFF1A${item.hitDislikedTags.join("\u3001")}`);
  return parts.join("\uFF1B") || "\u6807\u7B7E\u4E00\u822C\uFF0C\u5148\u8BD5\u8BFB";
}

// src/reader/scheduler.ts
var DIMENSIONS = ["newBooks", "chapters", "words", "tokens"];
var DIMENSION_LABEL = {
  newBooks: "\u65B0\u4E66",
  chapters: "\u7AE0\u8282",
  words: "\u5B57\u6570",
  tokens: "token"
};
function planNewBookSlots(input) {
  const cls = classifyMoment(momentFromDate(input.now, input.tzOffsetMinutes), input.windows);
  const remainingByDimension = {
    newBooks: Math.max(0, input.limits.newBooks - input.usage.newBooks),
    chapters: Math.max(0, input.limits.chapters - input.usage.chapters),
    words: Math.max(0, input.limits.words - input.usage.words),
    tokens: Math.max(0, input.limits.tokens - input.usage.tokens)
  };
  if (input.mode === "auto" && cls === "peak") {
    return {
      allowed: false,
      class: cls,
      reason: "\u5F53\u524D\u662F\u6A21\u578B\u9AD8\u5CF0\u65F6\u6BB5\uFF0C\u81EA\u52A8\u627E\u4E66\u4F1A\u7B49\u8C37\u65F6\u518D\u8DD1\uFF08\u53EF\u624B\u52A8\u8DD1\u4E00\u4E2A\u5C0F\u4EFB\u52A1\uFF09",
      remainingByDimension,
      slots: []
    };
  }
  const exhausted = DIMENSIONS.find((dimension) => remainingByDimension[dimension] === 0);
  if (exhausted) {
    return {
      allowed: false,
      class: cls,
      reason: `\u4ECA\u65E5${DIMENSION_LABEL[exhausted]}\u914D\u989D\u5DF2\u7528\u5B8C`,
      remainingByDimension,
      slots: []
    };
  }
  const ordered = [...input.readers].sort((a, b) => {
    const at = a.lastServedAt ? Date.parse(a.lastServedAt) : 0;
    const bt = b.lastServedAt ? Date.parse(b.lastServedAt) : 0;
    return at - bt || a.readerId.localeCompare(b.readerId);
  });
  const maxSlots = Math.min(input.maxSlots ?? 3, remainingByDimension.newBooks);
  const slots = [];
  let left = remainingByDimension.newBooks;
  for (const reader of ordered) {
    if (slots.length >= maxSlots || left <= 0) break;
    const usage = reader.usage ?? emptyUsage();
    const readerRemaining = {
      newBooks: Math.max(0, input.readerLimit.newBooks - usage.newBooks),
      chapters: Math.max(0, input.readerLimit.chapters - usage.chapters),
      words: Math.max(0, input.readerLimit.words - usage.words),
      tokens: Math.max(0, input.readerLimit.tokens - usage.tokens)
    };
    if (DIMENSIONS.some((dimension) => readerRemaining[dimension] === 0)) continue;
    slots.push({
      readerId: reader.readerId,
      remaining: Math.min(readerRemaining.newBooks, left),
      reason: reader.lastServedAt ? `\u4E0A\u6B21\u8C03\u5EA6\uFF1A${reader.lastServedAt}` : "\u4ECA\u5929\u8FD8\u6CA1\u8F6E\u5230"
    });
    left = Math.max(0, left - Math.min(readerRemaining.newBooks, left));
  }
  return {
    allowed: slots.length > 0,
    class: cls,
    reason: slots.length > 0 ? void 0 : "\u6CA1\u6709\u53EF\u8C03\u5EA6\u7684\u8BFB\u8005\uFF08\u90FD\u5230\u6BCF\u8BFB\u8005\u4E0A\u9650\u4E86\uFF09",
    remainingByDimension,
    slots
  };
}

// src/reader/comments.ts
var CONCERNS = [
  { label: "\u723D\u70B9", keywords: ["\u723D", "\u71C3", "\u6253\u8138", "\u89E3\u6C14", "\u4E0A\u5934"] },
  { label: "\u4EBA\u7269", keywords: ["\u4EBA\u7269", "\u89D2\u8272", "\u4EBA\u8BBE", "\u6027\u683C", "\u7537\u4E3B", "\u5973\u4E3B"] },
  { label: "\u611F\u60C5\u7EBF", keywords: ["\u611F\u60C5", "cp", "\u7CD6", "\u751C", "\u8650", "\u5FC3\u52A8"] },
  { label: "\u8282\u594F", keywords: ["\u8282\u594F", "\u62D6", "\u6C34", "\u5FEB", "\u6162", "\u5570\u55E6"] },
  { label: "\u903B\u8F91", keywords: ["\u903B\u8F91", "bug", "\u77DB\u76FE", "\u4E0D\u5408\u7406", "\u964D\u667A"] },
  { label: "\u4F0F\u7B14", keywords: ["\u4F0F\u7B14", "\u94FA\u57AB", "\u53CD\u8F6C", "\u57CB"] },
  { label: "\u6587\u7B14", keywords: ["\u6587\u7B14", "\u63CF\u5199", "\u53E5\u5B50", "\u9063\u8BCD"] },
  { label: "\u60C5\u7EEA", keywords: ["\u54ED", "\u7B11", "\u7834\u9632", "\u611F\u52A8", "\u5C2C"] },
  { label: "\u5F03\u4E66", keywords: ["\u5F03", "\u770B\u4E0D\u4E0B\u53BB", "\u64A4\u9000"] },
  { label: "\u66F4\u65B0", keywords: ["\u66F4\u65B0", "\u52A0\u66F4", "\u50AC\u66F4"] }
];
var TONE_HINTS = [
  { label: "\u77ED\u8BC4\u4E3A\u4E3B", keywords: [] },
  { label: "\u5E26\u6897\u5410\u69FD", keywords: ["\u54C8", "\u7B11\u6B7B", "\u72D7\u5934", "doge", "\u8349"] },
  { label: "\u8003\u636E\u5F0F\u957F\u8BC4", keywords: ["\u5176\u5B9E", "\u56E0\u4E3A", "\u7B2C", "\u4F0F\u7B14"] },
  { label: "\u60C5\u7EEA\u5316", keywords: ["\u554A", "\uFF01", "\u545C\u545C", "\u54ED"] }
];
function distillCommentEvidence(comments, limit = 200) {
  const sampled = comments.slice(0, Math.max(0, limit));
  if (sampled.length === 0) {
    return {
      total: comments.length,
      sampled: 0,
      paragraphCommentRatio: 0,
      avgLength: 0,
      concerns: [],
      toneHints: [],
      available: false
    };
  }
  const paragraph = sampled.filter((c) => typeof c.paragraphIndex === "number" && c.paragraphIndex >= 0).length;
  const counts = /* @__PURE__ */ new Map();
  for (const comment of sampled) {
    const text = comment.text.toLowerCase();
    for (const concern of CONCERNS) {
      if (concern.keywords.some((k) => text.includes(k.toLowerCase()))) {
        counts.set(concern.label, (counts.get(concern.label) ?? 0) + 1);
      }
    }
  }
  const totalLen = sampled.reduce((sum, c) => sum + [...c.text].length, 0);
  const toneCounts = /* @__PURE__ */ new Map();
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
  const toneHints = [];
  if (avgLength <= 20) toneHints.push("\u77ED\u8BC4\u4E3A\u4E3B");
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
    available: true
  };
}
function commentStyleHints(evidence) {
  if (!evidence.available) return [];
  const hints = [];
  if (evidence.paragraphCommentRatio >= 0.3) hints.push("\u771F\u4EBA\u7231\u5728\u6BB5\u843D\u4E2D\u9014\u7559\u8BC4");
  if (evidence.avgLength <= 20) hints.push("\u8BC4\u8BBA\u504F\u77ED");
  if (evidence.avgLength >= 60) hints.push("\u8BC4\u8BBA\u504F\u957F");
  const top = evidence.concerns[0];
  if (top) hints.push(`\u6700\u5173\u6CE8\uFF1A${top.label}`);
  for (const tone of evidence.toneHints) hints.push(`\u8BED\u6C14\uFF1A${tone}`);
  return hints;
}

// src/reader/source.ts
var SourceStopError = class extends Error {
  reason;
  constructor(reason, message) {
    super(message);
    this.name = "SourceStopError";
    this.reason = reason;
  }
};

// src/reader/fake-source.ts
var DEMO_BOOKS = [
  {
    book: {
      bookId: "fake-sys-1",
      title: "\u6211\u5728\u672B\u65E5\u5F00\u7CFB\u7EDF",
      author: "\u8001K",
      tags: ["\u672B\u4E16", "\u7CFB\u7EDF\u6D41", "\u5347\u7EA7", "\u5FEB\u8282\u594F", "\u723D\u6587"],
      summary: "\u672B\u4E16\u7B2C\u5341\u5E74\uFF0C\u4E3B\u89D2\u7A81\u7136\u6536\u5230\u4E00\u4E2A\u6BCF\u65E5\u7B7E\u5230\u7684\u7CFB\u7EDF\u3002"
    },
    chapters: [
      {
        chapterId: "c1",
        sequenceNumber: 1,
        title: "\u7B2C\u4E00\u7AE0 \u7B7E\u5230",
        content: "\u5929\u4EAE\u4E86\u3002\n\n\u6797\u8D8A\u4ECE\u9632\u7A7A\u6D1E\u7684\u9634\u5F71\u91CC\u5750\u8D77\u6765\uFF0C\u8111\u5B50\u91CC\u591A\u4E86\u4E00\u884C\u5B57\uFF1A\u4ECA\u65E5\u7B7E\u5230\u5DF2\u5237\u65B0\u3002\n\n\u4ED6\u76EF\u7740\u90A3\u884C\u5B57\u770B\u4E86\u4E09\u79D2\uFF0C\u7B11\u4E86\u3002"
      },
      {
        chapterId: "c2",
        sequenceNumber: 2,
        title: "\u7B2C\u4E8C\u7AE0 \u7B2C\u4E00\u7BB1\u7269\u8D44",
        content: "\u7B7E\u5230\u7684\u5956\u52B1\u662F\u4E00\u4E2A\u94C1\u7BB1\u3002\n\n\u7BB1\u5B50\u91CC\u6709\u534A\u7BB1\u538B\u7F29\u997C\u5E72\u548C\u4E00\u628A\u8FD8\u80FD\u7528\u7684\u5315\u9996\u3002\u6797\u8D8A\u628A\u5315\u9996\u63D2\u8FDB\u8170\u5E26\uFF0C\u51FA\u95E8\u524D\u56DE\u5934\u770B\u4E86\u4E00\u773C\u90A3\u884C\u5B57\u3002"
      }
    ],
    comments: [
      { text: "\u8FD9\u4E2A\u7CFB\u7EDF\u8BBE\u5B9A\u6709\u70B9\u610F\u601D\uFF0C\u8FFD\u4E86", likes: 12, paragraphIndex: 1 },
      { text: "\u8282\u594F\u771F\u5FEB\uFF0C\u7B2C\u4E00\u7AE0\u5C31\u7ED9\u4E1C\u897F", likes: 8 },
      { text: "\u5E0C\u671B\u522B\u5199\u5D29\uFF0C\u672B\u4E16\u6587\u592A\u5BB9\u6613\u5D29\u4E86", likes: 5 },
      { text: "\u7B11\u6B7B\uFF0C\u4E3B\u89D2\u5FC3\u771F\u5927", likes: 3 }
    ]
  },
  {
    book: {
      bookId: "fake-emotion-1",
      title: "\u65E7\u4FE1",
      author: "\u5357\u679D",
      tags: ["\u90FD\u5E02", "\u5355\u5973\u4E3B", "\u6162\u70ED", "\u751C\u5BA0", "\u63CF\u5199\u7EC6\u817B"],
      summary: "\u5979\u6574\u7406\u65E7\u7269\u65F6\u7FFB\u51FA\u4E00\u5C01\u6CA1\u5BC4\u51FA\u7684\u4FE1\u3002"
    },
    chapters: [
      {
        chapterId: "c1",
        sequenceNumber: 1,
        title: "\u7B2C\u4E00\u7AE0 \u62BD\u5C49",
        content: "\u642C\u5BB6\u90A3\u5929\uFF0C\u5979\u5728\u6700\u5E95\u5C42\u7684\u62BD\u5C49\u91CC\u6478\u5230\u4E00\u4E2A\u725B\u76AE\u7EB8\u4FE1\u5C01\u3002\n\n\u4FE1\u6CA1\u6709\u5BC4\u51FA\uFF0C\u90AE\u6233\u7684\u4F4D\u7F6E\u7A7A\u7740\u3002\u5979\u5750\u5728\u5730\u677F\u4E0A\uFF0C\u8BFB\u4E86\u4E09\u884C\uFF0C\u53C8\u6298\u56DE\u53BB\u91CD\u65B0\u8BFB\u3002"
      }
    ],
    comments: [
      { text: "\u8FD9\u6BB5\u5199\u5F97\u597D\u7EC6\uFF0C\u5FC3\u52A8", likes: 21, paragraphIndex: 1 },
      { text: "\u6162\u70ED\u4F46\u597D\u770B\uFF0C\u4F5C\u8005\u6587\u7B14\u5728\u7EBF", likes: 9 },
      { text: "\u7537\u4E3B\u8981\u5FEB\u70B9\u51FA\u573A\u554A", likes: 4 }
    ]
  },
  {
    book: {
      bookId: "fake-plot-1",
      title: "\u7B2C\u4E03\u7801\u5934",
      author: "\u8001K",
      tags: ["\u60AC\u7591", "\u63A2\u6848", "\u4F0F\u7B14\u5BC6\u96C6", "\u8003\u636E", "\u7FA4\u50CF"],
      summary: "\u7801\u5934\u63A5\u8FDE\u5931\u8E2A\u7684\u8239\u5458\uFF0C\u548C\u4E8C\u5341\u5E74\u524D\u7684\u4E00\u6869\u65E7\u6848\u6709\u5173\u3002"
    },
    chapters: [
      {
        chapterId: "c1",
        sequenceNumber: 1,
        title: "\u7B2C\u4E00\u7AE0 \u7A7A\u8239",
        content: "\u8239\u662F\u7A7A\u7684\u3002\n\n\u7B2C\u4E03\u7801\u5934\u7684\u4EBA\u8BF4\uFF0C\u6628\u591C\u6CA1\u6709\u8239\u9760\u5CB8\uFF0C\u53EF\u7532\u677F\u4E0A\u7684\u6C34\u8FF9\u8FD8\u6CA1\u5E72\u3002\u8001\u5468\u8E72\u4E0B\u53BB\uFF0C\u7528\u624B\u6307\u62B9\u4E86\u4E00\u628A\uFF0C\u95FB\u4E86\u95FB\u3002"
      }
    ],
    comments: [
      { text: "\u4F0F\u7B14\u57CB\u5F97\u771F\u5BC6\uFF0C\u6211\u8BB0\u4E86\u4E09\u6761", likes: 15, paragraphIndex: 1 },
      { text: "\u8FD9\u4E2A\u7EC6\u8282\u8003\u636E\u5F88\u7EC6\uFF0C\u4E0D\u50CF\u778E\u5199", likes: 7 },
      { text: "\u8282\u594F\u504F\u6162\uFF0C\u4F46\u903B\u8F91\u5728\u7EBF", likes: 3 }
    ]
  },
  {
    book: {
      bookId: "fake-harem-1",
      title: "\u957F\u5B89\u5341\u4E8C\u697C",
      author: "\u9752\u886B",
      tags: ["\u5386\u53F2", "\u591A\u5973\u4E3B", "\u540E\u5BAB", "\u8F7B\u677E\u641E\u7B11", "\u723D\u6587"],
      summary: "\u7A7F\u8D8A\u5230\u957F\u5B89\uFF0C\u5F00\u5C40\u4E00\u95F4\u9152\u697C\uFF0C\u5BA2\u4EBA\u5168\u662F\u9EBB\u70E6\u3002"
    },
    chapters: [
      {
        chapterId: "c1",
        sequenceNumber: 1,
        title: "\u7B2C\u4E00\u7AE0 \u5F00\u5C40\u4E00\u95F4\u7834\u697C",
        content: "\u957F\u5B89\u57CE\u4E1C\uFF0C\u5341\u4E8C\u697C\u5012\u4E86\u5341\u4E00\u697C\u3002\n\n\u5269\u4E0B\u90A3\u4E00\u697C\u91CC\uFF0C\u5750\u7740\u4E09\u4E2A\u4E0D\u80AF\u8D70\u7684\u59D1\u5A18\u548C\u4E00\u4E2A\u4E0D\u80AF\u7ED3\u8D26\u7684\u5BA2\u4EBA\u3002"
      }
    ],
    comments: [
      { text: "\u597D\u7B11\uFF0C\u8282\u594F\u4E5F\u5FEB", likes: 18 },
      { text: "\u540E\u5BAB\u5411\uFF0C\u5148\u89C2\u671B", likes: 2 }
    ]
  }
];
var FakeSource = class {
  id = "fake";
  capabilities = { search: true, readChapter: true, readComments: true };
  books;
  constructor(books = DEMO_BOOKS) {
    this.books = books;
  }
  async search(query, _signal) {
    const text = (query.text ?? "").toLowerCase();
    const tags = new Set(query.tags ?? []);
    const limit = query.limit ?? 10;
    return this.books.filter((entry) => {
      if (text && !`${entry.book.title} ${entry.book.author}`.toLowerCase().includes(text)) return false;
      if (tags.size > 0 && !entry.book.tags.some((t) => tags.has(t))) return false;
      return true;
    }).slice(0, limit).map((entry) => ({ book: entry.book, sourceId: this.id, sourceSite: "fake.local" }));
  }
  async fetchChapter(bookId, chapterId, _signal) {
    const entry = this.books.find((b) => b.book.bookId === bookId);
    if (!entry) throw new SourceStopError("temporarily_unavailable", `\u4E66\u4E0D\u5B58\u5728\uFF1A${bookId}`);
    if (chapterId === "c3") throw new SourceStopError("layout_changed", "\u6F14\u793A\uFF1A\u7AD9\u70B9\u7ED3\u6784\u53D8\u5316\uFF0C\u8BFB\u4E0D\u5230\u8FD9\u4E00\u7AE0");
    const chapter = entry.chapters.find((c) => c.chapterId === chapterId);
    if (!chapter) throw new SourceStopError("paywall", "\u6F14\u793A\uFF1A\u8FD9\u4E00\u7AE0\u9700\u8981\u4ED8\u8D39\u89E3\u9501");
    return {
      bookId,
      chapterId,
      sequenceNumber: chapter.sequenceNumber,
      title: chapter.title,
      content: chapter.content,
      contentHash: sha256Hex(chapter.content)
    };
  }
  async fetchComments(bookId, chapterId, _signal) {
    const entry = this.books.find((b) => b.book.bookId === bookId);
    return entry?.comments ?? [];
  }
};

// src/reader/review-engine.ts
var ReviewModelError = class extends Error {
  detail;
  constructor(message, detail = "") {
    super(message);
    this.name = "ReviewModelError";
    this.detail = detail;
  }
};
var SYSTEM = `\u4F60\u662F\u4E00\u4F4D\u771F\u5B9E\u7684\u7F51\u6587\u8BFB\u8005\uFF0C\u53EA\u8BC4\u4EF7\u4F60\u521A\u8BFB\u5B8C\u7684\u8FD9\u4E00\u7AE0\u3002
\u89C4\u5219\uFF1A
1. \u4F60\u53EA\u80FD\u4F7F\u7528\u300C\u4F60\u7684\u53E3\u5473\u300D\u548C\u300C\u4F60\u8BFB\u8FC7\u7684\u524D\u6587\u8BB0\u5FC6\u300D\uFF0C\u7EDD\u4E0D\u80FD\u5F15\u7528\u6216\u5047\u8BBE\u540E\u9762\u7684\u5267\u60C5\u3002
2. \u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF0C\u4E0D\u8981 markdown \u4EE3\u7801\u5757\u3001\u4E0D\u8981\u89E3\u91CA\u3002
3. \u661F\u7EA7 1\u20135 \u7684\u6574\u6570\uFF1B\u5FC5\u987B\u5728 chapterComment \u91CC\u8BF4\u660E\u4E3A\u4EC0\u4E48\u4E0D\u662F\u4E0A\u4E00\u6863/\u4E0B\u4E00\u6863\u3002
4. \u6BB5\u8BC4\u5FC5\u987B\u5F15\u7528\u672C\u7AE0\u539F\u6587\uFF0815\u201340 \u5B57\uFF09\uFF0Cquote \u5FC5\u987B\u662F\u6B63\u6587\u91CC\u9010\u5B57\u5B58\u5728\u7684\u7247\u6BB5\u3002
5. \u5F03\u4E66\uFF08status=drop\uFF09\u5FC5\u987B\u7ED9 dropReasonCode\uFF1Aslow_pacing / character_break / logic_error / prose / formulaic / genre_mismatch / other\u3002
6. memory \u662F\u4F60\u8BFB\u5B8C\u8FD9\u4E00\u7AE0\u540E\u7684\u8BB0\u5FC6\uFF0C\u4E0D\u662F\u4F5C\u8005\u8BBE\u5B9A\uFF1Acharacters \u53EA\u8BB0\u4F60\u89C1\u8FC7/\u63A8\u65AD\u51FA\u7684\u4EBA\u7269\uFF0Cexpectations \u6700\u591A 8 \u6761\uFF0CunreadQuestions \u6700\u591A 8 \u6761\u3002`;
function buildReviewPrompt(input) {
  const { reader, taste, reviewMemory, content, chapterNumber, title } = input;
  const memoryLines = reviewMemory?.entries?.length ? reviewMemory.entries.map((e) => `\u7B2C ${e.chapterNumber} \u7AE0\u540E\uFF1A${e.memory}`).join("\n") : "\u8FD9\u662F\u4F60\u8BFB\u5230\u7684\u7B2C\u4E00\u7AE0\uFF0C\u4F60\u5BF9\u4E4B\u524D\u4E00\u65E0\u6240\u77E5\u3002";
  const liked = taste.likedTags.map((t) => `${t.tagId}(${t.weight.toFixed(2)})`).join("\u3001") || "\uFF08\u6CA1\u6709\u7279\u522B\u504F\u597D\uFF09";
  const disliked = taste.dislikedTags.map((t) => `${t.tagId}(${t.weight.toFixed(2)})`).join("\u3001") || "\uFF08\u6CA1\u6709\u660E\u786E\u96F7\u70B9\uFF09";
  const system = [
    SYSTEM,
    `\u4F60\u7684\u540D\u5B57\uFF1A${reader.name}`,
    `\u4F60\u7684\u4EBA\u8BBE\uFF1A${reader.persona}`,
    `\u4F60\u559C\u6B22\uFF1A${liked}`,
    `\u4F60\u8BA8\u538C\uFF1A${disliked}`,
    `\u4F60\u7684\u8BC4\u8BBA\u98CE\u683C\uFF1A${taste.commentStyle.join("\u3001") || "\u81EA\u7136\u53E3\u8BED"}`,
    `\u524D\u6587\u8BB0\u5FC6\uFF1A
${memoryLines}`,
    `\u8F93\u51FA JSON \u7ED3\u6784\uFF1A{"stars":1-5,"chapterComment":"...","status":"follow|watch|drop","dropReasonCode":"...\u53EF\u9009","segments":[{"quote":"...","prefix":"","suffix":"","paragraphIndex":0,"comment":"..."}],"memory":{"characters":[{"name":"...","belief":"...","confidence":"observed|inferred"}],"expectations":["..."],"emotionalTone":"...","unreadQuestions":["..."]}}`
  ].join("\n\n");
  const user = `\u3010\u7B2C ${chapterNumber} \u7AE0 \xB7 ${title}\u3011
${content}`;
  return {
    model: "reviewer",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    maxOutputTokens: 2400
  };
}
function extractJsonObject(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
    }
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fence?.[1]?.trim() ?? raw;
  const start = candidate.indexOf("{");
  if (start === -1) throw new ReviewModelError("\u6A21\u578B\u8F93\u51FA\u91CC\u6CA1\u6709 JSON \u5BF9\u8C61", raw.slice(0, 200));
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  throw new ReviewModelError("\u6A21\u578B\u8F93\u51FA\u7684 JSON \u4E0D\u5B8C\u6574", raw.slice(0, 200));
}
function asString(value, field, max) {
  if (typeof value !== "string") throw new ReviewModelError(`${field} \u5FC5\u987B\u662F\u5B57\u7B26\u4E32`);
  const text = value.trim();
  if (!text) throw new ReviewModelError(`${field} \u4E0D\u80FD\u4E3A\u7A7A`);
  if (text.length > max) throw new ReviewModelError(`${field} \u8D85\u8FC7 ${max} \u5B57`);
  return text;
}
var DROP_REASONS2 = [
  "slow_pacing",
  "character_break",
  "logic_error",
  "prose",
  "formulaic",
  "genre_mismatch",
  "other"
];
function parseReviewDraft(raw, input) {
  const json = extractJsonObject(raw);
  let obj;
  try {
    obj = JSON.parse(json);
  } catch (error) {
    throw new ReviewModelError(`JSON \u89E3\u6790\u5931\u8D25\uFF1A${error.message}`);
  }
  const stars = obj.stars;
  if (typeof stars !== "number" || !Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new ReviewModelError(`\u661F\u7EA7\u5FC5\u987B\u662F 1\u20135 \u7684\u6574\u6570\uFF0C\u6536\u5230 ${JSON.stringify(stars)}`);
  }
  const chapterComment = asString(obj.chapterComment, "chapterComment", 200);
  const status = obj.status;
  if (status !== "follow" && status !== "watch" && status !== "drop") {
    throw new ReviewModelError(`status \u975E\u6CD5\uFF1A${JSON.stringify(status)}`);
  }
  let dropReasonCode;
  if (status === "drop") {
    if (typeof obj.dropReasonCode !== "string" || !DROP_REASONS2.includes(obj.dropReasonCode)) {
      throw new ReviewModelError(`\u5F03\u4E66\u5FC5\u987B\u7ED9\u5408\u6CD5 dropReasonCode\uFF0C\u6536\u5230 ${JSON.stringify(obj.dropReasonCode)}`);
    }
    dropReasonCode = obj.dropReasonCode;
  }
  const segmentsRaw = obj.segments;
  if (segmentsRaw !== void 0 && !Array.isArray(segmentsRaw)) throw new ReviewModelError("segments \u5FC5\u987B\u662F\u6570\u7EC4");
  const segmentsList = segmentsRaw ?? [];
  if (segmentsList.length > 3) throw new ReviewModelError("\u6BB5\u8BC4\u6700\u591A 3 \u6761");
  const segmentComments = segmentsList.map((item, index) => {
    const seg = item;
    const quote = asString(seg.quote, `segments[${index}].quote`, 200);
    const paragraphIndex = seg.paragraphIndex;
    if (typeof paragraphIndex !== "number" || !Number.isInteger(paragraphIndex) || paragraphIndex < 0) {
      throw new ReviewModelError(`segments[${index}].paragraphIndex \u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570`);
    }
    const prefix = typeof seg.prefix === "string" ? seg.prefix.slice(0, 10) : "";
    const suffix = typeof seg.suffix === "string" ? seg.suffix.slice(0, 10) : "";
    const located = locateAnchor(input.content, { quote, prefix, suffix, paragraphIndex });
    if (located.match !== "exact" && located.match !== "normalized") {
      throw new ReviewModelError(`segments[${index}] \u5F15\u7528\u65E0\u6CD5\u5728\u6B63\u6587\u5B9A\u4F4D\uFF08${located.match}\uFF09`);
    }
    const comment = asString(seg.comment, `segments[${index}].comment`, 100);
    return { locator: { paragraphIndex, quote, prefix, suffix }, excerpt: quote, comment };
  });
  const memoryRaw = obj.memory;
  if (!memoryRaw || typeof memoryRaw !== "object") throw new ReviewModelError("\u7F3A\u5C11 memory");
  const memoryObj = memoryRaw;
  const charactersRaw = memoryObj.characters;
  if (!Array.isArray(charactersRaw) || charactersRaw.length > 20) throw new ReviewModelError("memory.characters \u5FC5\u987B\u662F\u6700\u591A 20 \u6761\u7684\u6570\u7EC4");
  const characters = charactersRaw.map((item, index) => {
    const c = item;
    if (typeof c.name !== "string" || !c.name.trim()) throw new ReviewModelError(`memory.characters[${index}].name \u975E\u6CD5`);
    if (typeof c.belief !== "string" || !c.belief.trim()) throw new ReviewModelError(`memory.characters[${index}].belief \u975E\u6CD5`);
    if (c.confidence !== "observed" && c.confidence !== "inferred") {
      throw new ReviewModelError(`memory.characters[${index}].confidence \u5FC5\u987B\u662F observed/inferred`);
    }
    return { name: c.name.trim().slice(0, 40), belief: c.belief.trim().slice(0, 120), confidence: c.confidence };
  });
  const stringList = (value, field, maxItems) => {
    if (value === void 0) return [];
    if (!Array.isArray(value)) throw new ReviewModelError(`${field} \u5FC5\u987B\u662F\u6570\u7EC4`);
    if (value.length > maxItems) throw new ReviewModelError(`${field} \u6700\u591A ${maxItems} \u6761`);
    return value.map((v, i) => asString(v, `${field}[${i}]`, 120));
  };
  const expectations = stringList(memoryObj.expectations, "memory.expectations", 8);
  const unreadQuestions = stringList(memoryObj.unreadQuestions, "memory.unreadQuestions", 8);
  const emotionalTone = memoryObj.emotionalTone === void 0 ? "" : asString(memoryObj.emotionalTone, "memory.emotionalTone", 80);
  return {
    stars,
    chapterComment,
    segmentComments,
    status,
    dropReasonCode,
    memory: { characters, expectations, emotionalTone, unreadQuestions }
  };
}
async function generateReview(port, input, options) {
  const request = buildReviewPrompt(input);
  const first = await port.generate(request, options);
  try {
    return { draft: parseReviewDraft(first.text, input), response: first, repaired: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const repair = {
      ...request,
      messages: [
        ...request.messages,
        { role: "user", content: `\u4F60\u4E0A\u4E00\u6B21\u7684\u8F93\u51FA\u4E0D\u5408\u89C4\uFF1A${message}
\u8BF7\u53EA\u8F93\u51FA\u4FEE\u6B63\u540E\u7684 JSON\uFF0C\u4E0D\u8981\u89E3\u91CA\u3002` },
        { role: "user", content: `\u4E0A\u6B21\u8F93\u51FA\uFF1A
${first.text.slice(0, 4e3)}` }
      ]
    };
    const second = await port.generate(repair, options);
    try {
      return { draft: parseReviewDraft(second.text, input), response: second, repaired: true };
    } catch (secondError) {
      throw new ReviewModelError(
        `\u6A21\u578B\u8F93\u51FA\u4E24\u6B21\u90FD\u4E0D\u5408\u89C4\uFF1A${secondError instanceof Error ? secondError.message : String(secondError)}`,
        second.text.slice(0, 300)
      );
    }
  }
}
function draftToRating(draft, context, usage) {
  return {
    readerId: context.readerId,
    target: context.target,
    stars: draft.stars,
    chapterComment: draft.chapterComment,
    segmentComments: draft.segmentComments,
    status: draft.status,
    dropReasonCode: draft.dropReasonCode,
    tasteVersion: context.tasteVersion,
    model: `${context.providerId}:${context.model}`,
    promptVersion: "review-v1",
    usage
  };
}
function mergeReviewMemory(previous, draft, chapter, now) {
  return {
    ...previous,
    readThrough: chapter.sequenceNumber,
    characters: draft.memory.characters,
    expectations: draft.memory.expectations,
    emotionalTone: draft.memory.emotionalTone,
    unreadQuestions: draft.memory.unreadQuestions,
    fatigueCounter: nextFatigue(previous.fatigueCounter, draft.stars),
    droppedReason: draft.status === "drop" ? draft.dropReasonCode ?? "other" : previous.droppedReason,
    updatedAt: now
  };
}
function advanceReviewMemory(previous, draft, chapter, now) {
  const summary = [
    `\u661F\u7EA7 ${draft.stars}`,
    draft.chapterComment,
    draft.memory.expectations.length ? `\u671F\u5F85\uFF1A${draft.memory.expectations.join("\uFF1B")}` : "",
    draft.memory.unreadQuestions.length ? `\u60AC\u5FF5\uFF1A${draft.memory.unreadQuestions.join("\uFF1B")}` : ""
  ].filter(Boolean).join("\uFF5C").slice(0, 500);
  const entries = [...previous?.entries ?? [], { chapterNumber: chapter.chapterNumber, memory: summary }].slice(-50);
  return {
    schemaVersion: 2,
    id: previous?.id ?? `review-mem-${chapter.readerId}-${chapter.bookId}`,
    readerId: chapter.readerId,
    bookId: chapter.bookId,
    generation: previous?.generation ?? 1,
    validThrough: chapter.chapterNumber,
    invalidFrom: null,
    entries,
    updatedAt: now
  };
}
function ratingTargetFor(chapter) {
  return {
    kind: "manuscript",
    bookId: chapter.bookId,
    chapterId: chapter.chapterId,
    contentHash: chapter.contentHash,
    chapterNumber: chapter.sequenceNumber,
    revision: chapter.revision
  };
}

// src/adapter/page-reader.ts
import { lookup } from "node:dns/promises";
var CAPTCHA_MARKERS = ["\u9A8C\u8BC1\u7801", "captcha", "\u4EBA\u673A\u9A8C\u8BC1", "\u6ED1\u52A8\u9A8C\u8BC1", "\u5B89\u5168\u9A8C\u8BC1"];
var PAYWALL_MARKERS = ["\u672C\u7AE0\u4E3A\u4ED8\u8D39\u7AE0\u8282", "\u8D2D\u4E70\u672C\u7AE0", "\u8BA2\u9605\u672C\u7AE0", "\u767B\u5F55\u540E\u9605\u8BFB"];
var MAX_REDIRECTS = 3;
async function readPublicPage(rawUrl, config) {
  const maxBytes = config.maxBytes ?? 512 * 1024;
  const timeoutMs = config.timeoutMs ?? 1e4;
  const fetchImpl = config.fetchImpl ?? fetch;
  const lookupImpl = config.lookupImpl ?? ((hostname) => lookup(hostname, { all: true }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = parseUrl(rawUrl);
    let response = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertUrlAllowed(current, config, lookupImpl);
      response = await fetchImpl(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "user-agent": "MaguaNovel-reader/0.2 (+personal reading)" }
      });
      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new SourceStopError("unsupported", "\u91CD\u5B9A\u5411\u7F3A\u5C11 Location");
        current = parseUrl(new URL(location, current).toString());
        continue;
      }
      break;
    }
    if (!response) throw new SourceStopError("temporarily_unavailable", "\u6CA1\u6709\u62FF\u5230\u54CD\u5E94");
    if (isRedirect(response.status)) throw new SourceStopError("unsupported", "\u91CD\u5B9A\u5411\u6B21\u6570\u8FC7\u591A\uFF0C\u505C\u6B62");
    assertStatus(response.status);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new SourceStopError("unsupported", `\u4E0D\u652F\u6301\u7684\u5185\u5BB9\u7C7B\u578B\uFF1A${contentType || "unknown"}`);
    }
    const body = await readBoundedBody(response, maxBytes);
    const bytes = new TextEncoder().encode(body).length;
    const lower = body.toLowerCase();
    if (CAPTCHA_MARKERS.some((m) => lower.includes(m.toLowerCase()))) {
      throw new SourceStopError("captcha", "\u9875\u9762\u51FA\u73B0\u9A8C\u8BC1\u7801\uFF0C\u505C\u6B62\uFF08\u8BF7\u4EBA\u5DE5\u5904\u7406\uFF09");
    }
    if (PAYWALL_MARKERS.some((m) => lower.includes(m.toLowerCase()))) {
      throw new SourceStopError("paywall", "\u9875\u9762\u63D0\u793A\u9700\u8981\u4ED8\u8D39/\u767B\u5F55\uFF0C\u505C\u6B62");
    }
    return { url: current.toString(), host: current.hostname, title: extractTitle(body), text: htmlToText(body), bytes };
  } finally {
    clearTimeout(timer);
  }
}
function parseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new SourceStopError("unsupported", `\u4E0D\u662F\u5408\u6CD5\u7684 URL\uFF1A${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SourceStopError("unsupported", `\u53EA\u652F\u6301 http/https\uFF0C\u6536\u5230 ${url.protocol}`);
  }
  if (url.username || url.password) throw new SourceStopError("unsupported", "URL \u91CC\u4E0D\u5141\u8BB8\u5E26\u8D26\u53F7\u5BC6\u7801");
  return url;
}
async function assertUrlAllowed(url, config, lookupImpl) {
  if (!config.allowedHosts.includes(url.hostname)) {
    throw new SourceStopError("unsupported", `\u7AD9\u70B9\u4E0D\u5728\u5141\u8BB8\u5217\u8868\uFF1A${url.hostname}`);
  }
  if (config.allowPrivateHosts) return;
  let addresses;
  try {
    addresses = await lookupImpl(url.hostname);
  } catch {
    throw new SourceStopError("temporarily_unavailable", `\u57DF\u540D\u89E3\u6790\u5931\u8D25\uFF1A${url.hostname}`);
  }
  if (addresses.length === 0) throw new SourceStopError("temporarily_unavailable", `\u57DF\u540D\u6CA1\u6709\u89E3\u6790\u7ED3\u679C\uFF1A${url.hostname}`);
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new SourceStopError("unsupported", `\u62D2\u7EDD\u8BBF\u95EE\u672C\u673A/\u79C1\u7F51\u5730\u5740\uFF1A${url.hostname} \u2192 ${address}`);
    }
  }
}
function isPrivateAddress(address) {
  let value = address.toLowerCase();
  if (value === "::1" || value === "::") return true;
  if (value.startsWith("::ffff:")) {
    const rest = value.slice("::ffff:".length);
    if (rest.includes(".")) return isPrivateAddress(rest);
    const groups = rest.split(":");
    if (groups.length === 2) {
      const high = Number.parseInt(groups[0], 16);
      const low = Number.parseInt(groups[1], 16);
      if (Number.isFinite(high) && Number.isFinite(low)) {
        value = `${high >> 8 & 255}.${high & 255}.${low >> 8 & 255}.${low & 255}`;
      }
    }
  }
  if (value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
}
function isRedirect(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
function assertStatus(status) {
  if (status === 401 || status === 403) {
    throw new SourceStopError("paywall", `\u7AD9\u70B9\u8FD4\u56DE ${status}\uFF0C\u9700\u8981\u767B\u5F55\u6216\u4ED8\u8D39\uFF0C\u505C\u6B62`);
  }
  if (status === 429) throw new SourceStopError("rate_limited", "\u7AD9\u70B9\u9650\u901F\uFF08429\uFF09\uFF0C\u672C\u8F6E\u505C\u6B62");
  if (status >= 300 && status < 400) throw new SourceStopError("unsupported", `\u672A\u5904\u7406\u7684\u91CD\u5B9A\u5411\u72B6\u6001\uFF1A${status}`);
  if (status < 200 || status >= 300) throw new SourceStopError("temporarily_unavailable", `\u7AD9\u70B9\u8FD4\u56DE ${status}`);
}
async function readBoundedBody(response, maxBytes) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => void 0);
        throw new SourceStopError("unsupported", `\u9875\u9762\u8D85\u8FC7\u5927\u5C0F\u4E0A\u9650\uFF08> ${maxBytes} \u5B57\u8282\uFF09`);
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}
function extractTitle(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1].replace(/\s+/g, " ").trim()) : "";
}
function htmlToText(html) {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<noscript[\s\S]*?<\/noscript>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const withBreaks = withoutScripts.replace(/<\/(p|div|h[1-6]|li|br|section|article)>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, "");
  return decodeEntities(stripped).split("\n").map((line) => line.replace(/[ \t\u3000]+/g, " ").trim()).filter((line, index, all) => line.length > 0 || all[index - 1]?.length !== 0).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function decodeEntities(text) {
  return text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// src/adapter/journal.ts
import path2 from "node:path";
import { mkdir as mkdir2, readFile as readFile2, readdir as readdir2, rename as rename2, unlink as unlink2 } from "node:fs/promises";
import { existsSync as existsSync2 } from "node:fs";
var PENDING = "journal/pending";
var FAILED = "journal/failed";
async function writeJournalRun(root, run) {
  const file = path2.join(root, PENDING, `${String(run.seq).padStart(16, "0")}-${run.txId}.json`);
  await atomicWrite(file, `${JSON.stringify(run, null, 2)}
`);
  return file;
}
function isReadingMemory(value) {
  const memory = value;
  if (!memory || typeof memory !== "object") return false;
  if (memory.schemaVersion !== 2) return false;
  if (typeof memory.id !== "string" || typeof memory.readerId !== "string" || typeof memory.bookId !== "string") return false;
  if (typeof memory.readThrough !== "number" || !Number.isInteger(memory.readThrough) || memory.readThrough < 0) return false;
  if (!Array.isArray(memory.characters)) return false;
  for (const character of memory.characters) {
    if (!character || typeof character.name !== "string" || typeof character.belief !== "string") return false;
    if (character.confidence !== "observed" && character.confidence !== "inferred") return false;
  }
  if (!Array.isArray(memory.expectations) || !memory.expectations.every((x) => typeof x === "string")) return false;
  if (typeof memory.emotionalTone !== "string") return false;
  if (!Array.isArray(memory.unreadQuestions) || !memory.unreadQuestions.every((x) => typeof x === "string")) return false;
  if (typeof memory.fatigueCounter !== "number" || !Number.isFinite(memory.fatigueCounter)) return false;
  if (!(memory.droppedReason === null || typeof memory.droppedReason === "string")) return false;
  if (typeof memory.updatedAt !== "string") return false;
  return true;
}
function isReviewMemory(value) {
  const memory = value;
  if (!memory || typeof memory !== "object") return false;
  if (memory.schemaVersion !== 2) return false;
  if (typeof memory.id !== "string" || typeof memory.readerId !== "string" || typeof memory.bookId !== "string") return false;
  if (typeof memory.generation !== "number" || typeof memory.validThrough !== "number") return false;
  if (!(memory.invalidFrom === null || typeof memory.invalidFrom === "number")) return false;
  if (!Array.isArray(memory.entries)) return false;
  for (const entry of memory.entries) {
    if (!entry || typeof entry.chapterNumber !== "number" || typeof entry.memory !== "string") return false;
  }
  if (typeof memory.updatedAt !== "string") return false;
  return true;
}
function isChapterRating(value) {
  const rating = value;
  if (!rating || typeof rating !== "object") return false;
  if (rating.schemaVersion !== 2) return false;
  if (typeof rating.id !== "string" || typeof rating.readerId !== "string") return false;
  if (!rating.target || typeof rating.target !== "object") return false;
  if (typeof rating.target.bookId !== "string" || typeof rating.target.chapterId !== "string") return false;
  if (typeof rating.stars !== "number" || !Number.isInteger(rating.stars) || rating.stars < 1 || rating.stars > 5) return false;
  if (typeof rating.chapterComment !== "string" || rating.chapterComment.length === 0) return false;
  if (!Array.isArray(rating.segmentComments)) return false;
  if (rating.status !== "follow" && rating.status !== "watch" && rating.status !== "drop") return false;
  return true;
}
function isJournalRun(value) {
  const run = value;
  if (!run || typeof run !== "object") return false;
  if (run.schemaVersion !== 2) return false;
  if (run.kind !== "read-chapter" && run.kind !== "review-chapter") return false;
  if (typeof run.seq !== "number" || !Number.isFinite(run.seq)) return false;
  if (typeof run.txId !== "string" || run.txId.length === 0) return false;
  if (typeof run.readerId !== "string" || typeof run.bookId !== "string") return false;
  if (!isReadingMemory(run.memory)) return false;
  if (run.memory.readerId !== run.readerId || run.memory.bookId !== run.bookId) return false;
  if (run.kind === "review-chapter") {
    if (!isChapterRating(run.rating)) return false;
    if (run.rating.readerId !== run.readerId || run.rating.target.bookId !== run.bookId) return false;
    if (!isReviewMemory(run.reviewMemoryAfter)) return false;
    if (run.reviewMemoryAfter.readerId !== run.readerId || run.reviewMemoryAfter.bookId !== run.bookId) return false;
  }
  if (!run.usage || typeof run.usage.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(run.usage.date) || !run.usage.delta) return false;
  const delta = run.usage.delta;
  for (const key of ["chapters", "words", "tokens"]) {
    if (typeof delta[key] !== "number" || !Number.isFinite(delta[key]) || delta[key] < 0) return false;
  }
  if (typeof delta.unknown !== "boolean") return false;
  return true;
}
async function listJournalRuns(root) {
  const dir = path2.join(root, PENDING);
  if (!existsSync2(dir)) return [];
  const names = (await readdir2(dir)).filter((n) => n.endsWith(".json")).sort();
  const out = [];
  for (const name of names) {
    const file = path2.join(dir, name);
    let raw;
    try {
      raw = await readFile2(file, "utf8");
    } catch (error) {
      throw new Error(`\u8BFB\u53D6\u63D0\u4EA4\u65E5\u5FD7\u5931\u8D25\uFF1A${file}\uFF08\u65E5\u5FD7\u4FDD\u7559\u5728 pending\uFF09\uFF1A${error instanceof Error ? error.message : String(error)}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await quarantineJournalFile(root, name);
      continue;
    }
    if (!isJournalRun(parsed)) {
      await quarantineJournalFile(root, name);
      continue;
    }
    out.push({ file, run: parsed });
  }
  return out.sort((a, b) => a.run.seq - b.run.seq || a.run.txId.localeCompare(b.run.txId));
}
async function removeJournalRun(root, txId, seq) {
  await unlink2(path2.join(root, PENDING, `${String(seq).padStart(16, "0")}-${txId}.json`)).catch(() => void 0);
}
async function quarantineJournalFile(root, name) {
  const dir = path2.join(root, FAILED);
  await mkdir2(dir, { recursive: true });
  await rename2(path2.join(root, PENDING, name), path2.join(dir, `${Date.now()}-${name}`)).catch(() => void 0);
}

// src/adapter/service.ts
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var ReaderService = class {
  workspaceRoot;
  root;
  limits;
  globalQuota;
  readerQuota;
  clock;
  tzOffsetMinutes;
  source;
  allowedPageHosts;
  allowPrivateHosts;
  reviewPort;
  globalRoot;
  lastSeq = 0;
  constructor(workspaceRoot, options = {}) {
    this.workspaceRoot = workspaceRoot;
    this.root = readerRoot(workspaceRoot);
    const requestedMax = options.limits?.maxReaders ?? DEFAULT_READER_LIMITS.maxReaders;
    const hardMax = options.limits?.hardMaxReaders ?? DEFAULT_READER_LIMITS.hardMaxReaders;
    this.limits = resolveReaderLimits(requestedMax, { maxReaders: requestedMax, hardMaxReaders: hardMax });
    this.globalQuota = { ...DEFAULT_GLOBAL_QUOTA, ...options.globalQuota };
    this.readerQuota = { ...DEFAULT_READER_QUOTA, ...options.readerQuota };
    this.clock = options.clock ?? (() => /* @__PURE__ */ new Date());
    this.tzOffsetMinutes = options.tzOffsetMinutes ?? 480;
    this.source = options.source ?? null;
    this.allowedPageHosts = options.allowedPageHosts ?? [];
    this.allowPrivateHosts = options.allowPrivateHosts ?? false;
    this.reviewPort = options.reviewPort ?? null;
    this.globalRoot = options.globalRoot ? path3.resolve(options.globalRoot) : this.root;
  }
  async init() {
    await ensureLayout(this.workspaceRoot);
    await mkdir3(path3.join(this.globalRoot, "readers"), { recursive: true });
    await this.recoverJournal();
    return this;
  }
  /** 崩溃恢复：按 seq 顺序重放未完成的提交日志（记忆只前进、配额按 txId 去重） */
  async recoverJournal() {
    const runs = await listJournalRuns(this.root);
    let recovered = 0;
    for (const { run } of runs) {
      try {
        await this.withWriteLock(() => this.applyJournalRun(run));
        recovered++;
      } catch (error) {
        throw new Error(
          `\u63D0\u4EA4\u65E5\u5FD7\u6062\u590D\u5931\u8D25\uFF1A${run.txId}\uFF08\u65E5\u5FD7\u4FDD\u7559\u5728 journal/pending\uFF09\uFF1A${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return recovered;
  }
  /** 已持有写锁时使用：不再申请同一把锁，直接应用日志 */
  async recoverJournalLocked() {
    const runs = await listJournalRuns(this.root);
    let recovered = 0;
    for (const { run } of runs) {
      try {
        await this.applyJournalRun(run);
        recovered++;
      } catch (error) {
        throw new Error(
          `\u63D0\u4EA4\u65E5\u5FD7\u6062\u590D\u5931\u8D25\uFF1A${run.txId}\uFF08\u65E5\u5FD7\u4FDD\u7559\u5728 journal/pending\uFF09\uFF1A${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return recovered;
  }
  /** 还有待恢复日志时，不允许开始新的阅读写入 */
  async ensureJournalClean() {
    const pending = await listJournalRuns(this.root);
    if (pending.length === 0) return;
    await this.recoverJournalLocked();
    const left = await listJournalRuns(this.root);
    if (left.length > 0) throw new Error("\u8FD8\u6709\u672A\u6062\u590D\u7684\u63D0\u4EA4\u65E5\u5FD7\uFF08journal/pending\uFF09\uFF0C\u5148\u5904\u7406\u518D\u7EE7\u7EED");
  }
  /** 应用一条 journal：记忆（只前进）→ 配额（带 txId 去重）→ 回执 → 删除日志 */
  async applyJournalRun(run) {
    const reader = await this.getReader(run.readerId);
    if (!reader) throw new Error(`\u65E5\u5FD7\u5F15\u7528\u7684\u8BFB\u8005\u4E0D\u5B58\u5728\uFF1A${run.readerId}`);
    const memoryFile = this.readingMemoryFile(run.readerId, run.bookId);
    const current = await readJsonStrict(memoryFile);
    const shouldWrite = !current || run.memory.readThrough > current.readThrough || run.memory.readThrough === current.readThrough && run.memory.updatedAt >= current.updatedAt;
    if (shouldWrite) await writeJson(memoryFile, run.memory);
    if (run.reviewMemoryAfter) {
      const currentReview = await this.getReviewMemory(run.readerId, run.bookId);
      if (!currentReview || run.reviewMemoryAfter.validThrough > currentReview.validThrough) {
        await writeJson(this.reviewMemoryFile(run.readerId, run.bookId), run.reviewMemoryAfter);
      }
    }
    if (run.rating) {
      await writeJson(this.safePath("readers", run.readerId, "ratings", `${run.rating.id}.json`), run.rating);
    }
    const usage = await this.addUsageLocked(
      run.readerId,
      { chapters: run.usage.delta.chapters, words: run.usage.delta.words, tokens: run.usage.delta.tokens },
      run.txId,
      run.usage.date
    );
    if (run.usage.delta.unknown) {
      await this.addUsageLocked(run.readerId, { tokens: null }, `${run.txId}-unknown`, run.usage.date);
    }
    if (run.requestId) {
      const requestId = this.assertSafeRequestId(run.requestId);
      await writeJson(this.safePath("receipts", `${requestId}.json`), {
        requestId,
        at: run.at,
        result: { memory: run.memory, usage, ...run.rating ? { rating: run.rating, reviewMemory: run.reviewMemoryAfter } : {} }
      });
    }
    await removeJournalRun(this.root, run.txId, run.seq);
    return { memory: run.memory, usage };
  }
  /* --------------------------- 路径与锁（安全边界） --------------------------- */
  /** 所有落盘路径都必须落在数据根内；越界直接抛错 */
  safePath(...parts) {
    const root = path3.resolve(this.root);
    const target = path3.resolve(root, ...parts);
    if (target !== root && !target.startsWith(root + path3.sep)) {
      throw new Error(`\u8DEF\u5F84\u8D8A\u754C\uFF1A${parts.join("/")}`);
    }
    return target;
  }
  /** 读者/口味跨工作区共享：只把身份档案放在 globalRoot，评分与记忆仍随书留在工作区 */
  globalPath(...parts) {
    const root = path3.resolve(this.globalRoot);
    const target = path3.resolve(root, ...parts);
    if (target !== root && !target.startsWith(root + path3.sep)) {
      throw new Error(`\u8DEF\u5F84\u8D8A\u754C\uFF1A${parts.join("/")}`);
    }
    return target;
  }
  assertDate(date) {
    if (!DATE_RE.test(date)) throw new Error(`\u975E\u6CD5\u65E5\u671F\uFF1A${date}\uFF08\u8981\u6C42 YYYY-MM-DD\uFF09`);
    return date;
  }
  /**
   * 短事务锁：同一工作区同一时刻只允许一个写者。
   * 失败等 3 秒；陈旧锁（>10s）可回收。锁只保护短事务，不覆盖模型调用。
   */
  async withWriteLock(fn) {
    const lockDir = this.safePath("locks");
    await mkdir3(lockDir, { recursive: true });
    const lockFile = this.safePath("locks", "write.lock");
    const token = `${process.pid}-${randomUUID2()}`;
    const started = Date.now();
    for (; ; ) {
      try {
        const handle = await open(lockFile, "wx");
        await handle.writeFile(token);
        await handle.close();
        break;
      } catch {
        if (Date.now() - started > 3e3) {
          throw new Error("\u5199\u5165\u88AB\u5360\u7528\uFF1Alocks/write.lock \u8D85\u8FC7 3 \u79D2\u672A\u91CA\u653E\u3002\u82E5\u786E\u8BA4\u6CA1\u6709\u5176\u4ED6\u5199\u8005\uFF0C\u53EF\u624B\u52A8\u5220\u9664\u8BE5\u6587\u4EF6\u540E\u91CD\u8BD5");
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    try {
      return await fn();
    } finally {
      const content = await readFile3(lockFile, "utf8").catch(() => null);
      if (content === token) await unlink3(lockFile).catch(() => void 0);
    }
  }
  /** requestId / txId 只允许安全 basename，防止回执路径穿越 */
  assertSafeRequestId(id) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error(`\u975E\u6CD5 requestId\uFF1A${id}`);
    return id;
  }
  /** 单调提交序号（同毫秒内也严格递增） */
  nextSeq() {
    const next = Math.max(Date.now(), this.lastSeq + 1);
    this.lastSeq = next;
    return next;
  }
  /* ------------------------------- 读者 ------------------------------- */
  readerDir(readerId) {
    assertSafeId(readerId, "readerId");
    return this.globalPath("readers", readerId);
  }
  readerFile(readerId) {
    return this.globalPath("readers", readerId, "reader.json");
  }
  /** 标签目录：面板/工具用同一份真源（tags.ts） */
  listTagCatalog() {
    return tagCatalog();
  }
  /**
   * 按标签找书（不依赖某个读者的口味）：喜好标签做匹配、避雷标签硬过滤；
   * 未知标签不静默丢弃，随 unknownTags 回传，由界面提示「暂未收录」。
   */
  async searchByTags(input) {
    if (!this.source) throw new Error("\u6CA1\u6709\u914D\u7F6E\u4E66\u6E90\uFF08L1/L2\uFF09\uFF0C\u4E0D\u80FD\u81EA\u5DF1\u627E\u4E66");
    const normalize = (tags) => {
      const out = [];
      const unknown = [];
      for (const raw of tags ?? []) {
        const value = String(raw ?? "").trim();
        if (!value) continue;
        const known = canonicalTag(value);
        if (known) out.push(known);
        else {
          out.push(value);
          unknown.push(value);
        }
      }
      return { tags: [...new Set(out)], unknown: [...new Set(unknown)] };
    };
    const liked = normalize(input.tags);
    const disliked = normalize(input.excludeTags);
    if (!liked.tags.length && !disliked.tags.length) throw new Error("\u81F3\u5C11\u9009\u4E00\u4E2A\u6807\u7B7E\u518D\u627E\u4E66");
    const results = await this.searchSource({ tags: liked.tags, limit: 30 });
    const dislikedSet = new Set(disliked.tags);
    const candidates = results.map((result) => ({ ...result.book, sourceId: result.sourceId, sourceSite: result.sourceSite })).filter((book) => !book.tags.some((tag) => dislikedSet.has(tag)));
    const excluded = await this.exclusionSet(input.readerId);
    const picks = rankCandidates(
      {
        likedTags: liked.tags.map((tagId) => ({ tagId, weight: 1 })),
        dislikedTags: disliked.tags.map((tagId) => ({ tagId, weight: 1 })),
        likedAuthors: [],
        dislikedAuthors: []
      },
      candidates,
      { excludeBookIds: [...excluded], limit: Math.min(Math.max(input.limit ?? 5, 1), 10) }
    );
    return {
      picks,
      searchedTags: liked.tags,
      unknownTags: [.../* @__PURE__ */ new Set([...liked.unknown, ...disliked.unknown])],
      excludedBookIds: [...excluded].sort()
    };
  }
  /** 已读/已弃排除集合：给读者时按该读者，不给时按书架上全部书 + 任一读者的弃书 */
  async exclusionSet(readerId) {
    const excluded = /* @__PURE__ */ new Set();
    for (const rating of await this.listRatings(readerId ? { readerId } : {})) {
      if (rating.status === "drop") excluded.add(rating.target.bookId);
    }
    for (const book of await this.listBooks()) {
      if (!readerId) {
        excluded.add(book.bookId);
        continue;
      }
      const memory = await this.getReadingMemory(readerId, book.bookId);
      if (memory && memory.readThrough > 0) excluded.add(book.bookId);
    }
    return excluded;
  }
  normalizeTasteWeights(tags) {
    if (!tags) return void 0;
    const seen = /* @__PURE__ */ new Map();
    for (const item of tags) {
      const raw = String(item?.tagId ?? "").trim();
      if (!raw) continue;
      const tagId = canonicalTag(raw) ?? raw;
      seen.set(tagId, Math.max(seen.get(tagId) ?? 0, Number(item.weight) || 0));
    }
    return [...seen.entries()].map(([tagId, weight]) => ({ tagId, weight }));
  }
  async createReader(input) {
    const name = input.name?.trim();
    if (!name) throw new Error("\u8BFB\u8005\u540D\u5B57\u4E0D\u80FD\u4E3A\u7A7A");
    const persona = input.persona?.trim();
    if (!persona) throw new Error("\u8BFB\u8005\u4EBA\u8BBE\u4E0D\u80FD\u4E3A\u7A7A");
    const base = slugify(name);
    let id = base;
    let n = 1;
    const used = new Set((await this.listReaders(true)).map((r) => r.id));
    while (used.has(id)) id = `${base}-${++n}`;
    assertSafeId(id, "readerId");
    return this.withWriteLock(async () => {
      const live = (await this.listReaders(true)).filter((r) => r.status !== "deleted");
      assertCanCreateReader(live.length, this.limits);
      const now = this.clock().toISOString();
      const taste = createInitialTaste({
        readerId: id,
        now,
        ...input.taste ? {
          ...input.taste,
          likedTags: this.normalizeTasteWeights(input.taste.likedTags),
          dislikedTags: this.normalizeTasteWeights(input.taste.dislikedTags)
        } : {}
      });
      await this.writeTaste(taste);
      const reader = {
        schemaVersion: 2,
        id,
        name,
        status: "active",
        personaTemplateId: input.personaTemplateId,
        persona,
        revision: 1,
        tasteVersion: taste.version,
        createdAt: now
      };
      await writeJson(this.readerFile(id), reader);
      return reader;
    });
  }
  /** 用预置人设模板建一个读者（模板只复制到实例，不共享任何进度/记忆） */
  async createReaderFromTemplate(templateId, name) {
    const template = READER_PERSONA_TEMPLATES.find((t) => t.id === templateId);
    if (!template) throw new Error(`\u672A\u77E5\u8BFB\u8005\u6A21\u677F\uFF1A${templateId}`);
    return this.createReader({
      name: name ?? template.name,
      persona: template.persona,
      personaTemplateId: template.id,
      taste: {
        likedTags: template.likedTags,
        dislikedTags: template.dislikedTags,
        pacingTolerance: template.pacingTolerance,
        commentStyle: template.commentStyle,
        sensitivities: template.sensitivities
      }
    });
  }
  async listReaders(includeDeleted = false) {
    const dir = this.globalPath("readers");
    if (!existsSync3(dir)) return [];
    const names = (await readdir3(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    const out = [];
    for (const name of names.sort()) {
      const reader = await readJsonOptional(this.globalPath("readers", name, "reader.json"));
      if (!reader) continue;
      if (!includeDeleted && reader.status === "deleted") continue;
      out.push(reader);
    }
    return out;
  }
  async getReader(readerId) {
    return readJsonStrict(this.readerFile(readerId));
  }
  async requireReader(readerId) {
    const reader = await this.getReader(readerId);
    if (!reader || reader.status === "deleted") throw new Error(`\u8BFB\u8005\u4E0D\u5B58\u5728\uFF1A${readerId}`);
    return reader;
  }
  async setReaderStatus(readerId, status) {
    if (status !== "active" && status !== "paused" && status !== "deleted") {
      throw new Error(`\u975E\u6CD5\u8BFB\u8005\u72B6\u6001\uFF1A${String(status)}`);
    }
    return this.withWriteLock(async () => {
      const reader = await this.requireReader(readerId);
      const next = { ...reader, status, revision: reader.revision + 1 };
      await writeJson(this.readerFile(readerId), next);
      return next;
    });
  }
  /* ------------------------------- 口味 ------------------------------- */
  tasteFile(readerId, version) {
    assertSafeId(readerId, "readerId");
    if (!/^[a-f0-9]{6,64}$/.test(version)) throw new Error(`\u975E\u6CD5\u53E3\u5473\u7248\u672C\u53F7\uFF1A${version}`);
    return this.globalPath("readers", readerId, "taste", `${version}.json`);
  }
  async writeTaste(taste) {
    const file = this.tasteFile(taste.readerId, taste.version);
    if (existsSync3(file)) return;
    await writeJson(file, taste);
  }
  async getTaste(readerId, version) {
    const reader = await this.getReader(readerId);
    if (!reader) return null;
    const wanted = version ?? reader.tasteVersion;
    return readJsonStrict(this.tasteFile(readerId, wanted));
  }
  /** 口味更新：新版本 + reader 指向新版本；内容不变时不动 */
  async updateTasteProfile(readerId, patch, evidenceRatingIds = []) {
    return this.withWriteLock(async () => {
      const reader = await this.requireReader(readerId);
      const current = await this.getTaste(readerId, reader.tasteVersion);
      if (!current) throw new Error(`\u8BFB\u8005 ${readerId} \u7684\u5F53\u524D\u53E3\u5473\u7248\u672C\u4E22\u5931\uFF1A${reader.tasteVersion}`);
      const next = updateTaste(current, patch, evidenceRatingIds, this.clock().toISOString());
      if (next.version === current.version) return current;
      await this.writeTaste(next);
      await writeJson(this.readerFile(readerId), { ...reader, tasteVersion: next.version, revision: reader.revision + 1 });
      return next;
    });
  }
  /* -------------------------------- 书 -------------------------------- */
  bookDir(bookId) {
    assertSafeId(bookId, "bookId");
    return this.safePath("books", bookId);
  }
  bookFile(bookId) {
    return this.safePath("books", bookId, "book.json");
  }
  async importBook(input) {
    assertSafeId(input.bookId, "bookId");
    return this.withWriteLock(async () => {
      const existing = await readJsonStrict(this.bookFile(input.bookId));
      const now = this.clock().toISOString();
      const book = {
        schemaVersion: 2,
        bookId: input.bookId,
        title: input.title,
        author: input.author,
        sourceId: input.sourceId,
        sourceSite: input.sourceSite,
        tags: input.tags ?? [],
        accessLevel: input.accessLevel ?? "imported",
        addedAt: existing?.addedAt ?? now
      };
      await writeJson(this.bookFile(input.bookId), book);
      return book;
    });
  }
  async getBook(bookId) {
    assertSafeId(bookId, "bookId");
    return readJsonStrict(this.bookFile(bookId));
  }
  async listBooks() {
    const dir = this.safePath("books");
    if (!existsSync3(dir)) return [];
    const names = (await readdir3(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    const out = [];
    for (const name of names.sort()) {
      const book = await readJsonOptional(this.safePath("books", name, "book.json"));
      if (book) out.push(book);
    }
    return out;
  }
  chapterMetaFile(bookId, chapterId) {
    assertSafeId(chapterId, "chapterId");
    return this.safePath("books", bookId, "chapters", `${chapterId}.json`);
  }
  chapterContentFile(bookId, chapterId, revision) {
    return this.safePath("books", bookId, "content", `${chapterId}.r${revision}.json`);
  }
  /**
   * 导入章节：同样标题与正文重复导入是无变化操作（不涨 revision）。
   * 正文只统一 CRLF/CR → LF；不 trim、不改标点。
   */
  async importChapter(input) {
    assertSafeId(input.bookId, "bookId");
    assertSafeId(input.chapterId, "chapterId");
    if (!Number.isInteger(input.sequenceNumber) || input.sequenceNumber < 1) {
      throw new Error(`\u7AE0\u8282\u5E8F\u53F7\u5FC5\u987B\u662F >=1 \u7684\u6574\u6570\uFF0C\u6536\u5230 ${input.sequenceNumber}`);
    }
    const book = await this.getBook(input.bookId);
    if (!book) throw new Error(`\u4E66\u4E0D\u5B58\u5728\uFF1A${input.bookId}`);
    return this.withWriteLock(async () => {
      const normalized = input.content.replace(/\r\n?/g, "\n");
      const contentHash = sha256Hex(normalized);
      const wordCount = [...normalized.replace(/\s+/g, "")].length;
      const existing = await readJsonStrict(this.chapterMetaFile(input.bookId, input.chapterId));
      if (existing && existing.contentHash === contentHash && existing.title === input.title) {
        await this.consumeInvalidations(input.bookId);
        return { changed: false, revision: existing.revision, contentHash, wordCount: existing.wordCount };
      }
      const revision = (existing?.revision ?? 0) + 1;
      await writeJson(this.chapterContentFile(input.bookId, input.chapterId, revision), {
        chapterId: input.chapterId,
        revision,
        content: normalized,
        contentHash
      });
      if (existing) await this.markInvalidation(input.bookId, input.sequenceNumber, input.chapterId);
      const record = {
        schemaVersion: 2,
        chapterId: input.chapterId,
        sequenceNumber: input.sequenceNumber,
        title: input.title,
        revision,
        contentHash,
        wordCount,
        importedAt: this.clock().toISOString()
      };
      await writeJson(this.chapterMetaFile(input.bookId, input.chapterId), record);
      await this.consumeInvalidations(input.bookId);
      return { changed: true, revision, contentHash, wordCount };
    });
  }
  /** 改稿失效标记：`books/<id>/invalidation/<seq>.json`，重试时消费 */
  invalidationFile(bookId, sequenceNumber) {
    return this.safePath("books", bookId, "invalidation", `${sequenceNumber}.json`);
  }
  async markInvalidation(bookId, sequenceNumber, chapterId) {
    await writeJson(this.invalidationFile(bookId, sequenceNumber), {
      schemaVersion: 2,
      bookId,
      chapterId,
      sequenceNumber,
      at: this.clock().toISOString()
    });
  }
  /** 消费失效标记：把 validThrough ≥ N 的评审链回退到 N−1、generation+1；全部成功才删标记 */
  async consumeInvalidations(bookId) {
    const dir = this.safePath("books", bookId, "invalidation");
    const files = await listJsonFiles(dir);
    for (const file of files) {
      const marker = await readJsonStrict(file);
      const sequenceNumber = marker?.sequenceNumber;
      if (!Number.isInteger(sequenceNumber) || sequenceNumber < 1) {
        await unlink3(file).catch(() => void 0);
        continue;
      }
      for (const reader of await this.listReaders()) {
        const memory = await this.getReviewMemory(reader.id, bookId);
        if (!memory || memory.validThrough < sequenceNumber) continue;
        await writeJson(this.reviewMemoryFile(reader.id, bookId), {
          ...memory,
          validThrough: Math.max(0, sequenceNumber - 1),
          invalidFrom: memory.invalidFrom === null ? sequenceNumber : Math.min(memory.invalidFrom, sequenceNumber),
          generation: memory.generation + 1,
          updatedAt: this.clock().toISOString()
        });
      }
      await unlink3(file).catch(() => void 0);
    }
  }
  async getChapter(bookId, chapterId) {
    return readJsonStrict(this.chapterMetaFile(bookId, chapterId));
  }
  async getChapterContent(bookId, chapterId, revision) {
    const meta = await this.getChapter(bookId, chapterId);
    if (!meta) return null;
    if (meta.contentOrigin === "public-page") return null;
    const rev = revision ?? meta.revision;
    const data = await readJsonStrict(this.chapterContentFile(bookId, chapterId, rev));
    return data?.content ?? null;
  }
  async listChapters(bookId) {
    assertSafeId(bookId, "bookId");
    const dir = this.safePath("books", bookId, "chapters");
    const files = await listJsonFiles(dir);
    const out = [];
    for (const file of files) {
      const rec = await readJsonOptional(file);
      if (rec) out.push(rec);
    }
    return out.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }
  /**
   * L2：从用户给的公开网页导入一章（只允许配置过的站点）。
   * 版权/隐私边界：**外部正文只在本次调用内存里处理，不落盘** ——
   * 只保存元信息、内容指纹、字数与 ≤300 字短摘录；之后要重读必须重新抓取。
   */
  async importFromUrl(input) {
    assertSafeId(input.bookId, "bookId");
    assertSafeId(input.chapterId, "chapterId");
    if (this.allowedPageHosts.length === 0) {
      throw new Error("\u6CA1\u6709\u914D\u7F6E\u5141\u8BB8\u7684\u516C\u5F00\u7AD9\u70B9\uFF08allowedPageHosts\uFF09\uFF0C\u4E0D\u80FD\u4ECE\u7F51\u9875\u5BFC\u5165");
    }
    if (!Number.isInteger(input.sequenceNumber) || input.sequenceNumber < 1) {
      throw new Error(`\u7AE0\u8282\u5E8F\u53F7\u5FC5\u987B\u662F >=1 \u7684\u6574\u6570\uFF0C\u6536\u5230 ${input.sequenceNumber}`);
    }
    const page = await readPublicPage(input.url, {
      allowedHosts: this.allowedPageHosts,
      allowPrivateHosts: this.allowPrivateHosts,
      fetchImpl: input.fetchImpl
    });
    if (page.text.trim().length === 0) {
      throw new Error("\u9875\u9762\u6CA1\u6709\u53EF\u8BFB\u6B63\u6587\uFF08\u53EF\u80FD\u662F\u811A\u672C\u6E32\u67D3\u9875\uFF09\uFF0C\u8BF7\u6539\u7528\u7C98\u8D34/\u6587\u4EF6\u5BFC\u5165");
    }
    const excerpt = [...page.text].slice(0, 300).join("");
    const wordCount = [...page.text.replace(/\s+/g, "")].length;
    const contentHash = sha256Hex(page.text);
    const title = input.title ?? page.title ?? input.chapterId;
    const book = await this.importBook({
      bookId: input.bookId,
      title: page.title || input.bookId,
      sourceId: page.url,
      sourceSite: page.host,
      accessLevel: "public"
    });
    return this.withWriteLock(async () => {
      const existing = await readJsonStrict(this.chapterMetaFile(input.bookId, input.chapterId));
      if (existing && existing.contentHash === contentHash && existing.title === title) {
        return {
          book,
          chapter: existing,
          page: { title: page.title, host: page.host, bytes: page.bytes, excerptChars: [...existing.excerpt ?? ""].length }
        };
      }
      const revision = (existing?.revision ?? 0) + 1;
      await writeJson(this.chapterContentFile(input.bookId, input.chapterId, revision), {
        chapterId: input.chapterId,
        revision,
        excerptOnly: true,
        excerpt,
        contentHash
      });
      const chapter = {
        schemaVersion: 2,
        chapterId: input.chapterId,
        sequenceNumber: input.sequenceNumber,
        title,
        revision,
        contentHash,
        wordCount,
        importedAt: this.clock().toISOString(),
        contentOrigin: "public-page",
        excerpt
      };
      await writeJson(this.chapterMetaFile(input.bookId, input.chapterId), chapter);
      return { book, chapter, page: { title: page.title, host: page.host, bytes: page.bytes, excerptChars: [...excerpt].length } };
    });
  }
  /* -------------------------------- 找书 ------------------------------- */
  /** L1：搜索书源；标签会先过别名表，未知标签不冒充已知 */
  async searchSource(query) {
    if (!this.source) throw new Error("\u6CA1\u6709\u914D\u7F6E\u4E66\u6E90\uFF08L1/L2\uFF09\uFF0C\u53EA\u80FD\u5BFC\u5165\u7528\u6237\u81EA\u5E26\u7684\u4F5C\u54C1");
    const results = await this.source.search(query);
    return results.map((result) => ({ ...result, book: { ...result.book, tags: normalizeTags(result.book.tags).known } }));
  }
  /**
   * 按读者口味找书：取权重最高的几个喜欢标签去搜 → 排除已读/已弃 → 多样性排序。
   * 找不到就返回空，不硬凑。
   */
  async discoverForReader(readerId, limit = 3) {
    const reader = await this.requireReader(readerId);
    const taste = await this.getTaste(reader.id);
    if (!taste) throw new Error(`\u8BFB\u8005 ${readerId} \u6CA1\u6709\u53E3\u5473\u6863\u6848`);
    if (!this.source) throw new Error("\u6CA1\u6709\u914D\u7F6E\u4E66\u6E90\uFF08L1/L2\uFF09\uFF0C\u4E0D\u80FD\u81EA\u5DF1\u627E\u4E66");
    const searchedTags = [...taste.likedTags].sort((a, b) => b.weight - a.weight).slice(0, 4).map((t) => t.tagId);
    const results = await this.searchSource({ tags: searchedTags, limit: 20 });
    const candidates = results.map((r) => ({ ...r.book, sourceId: r.sourceId, sourceSite: r.sourceSite }));
    const excluded = await this.exclusionSet(reader.id);
    const picks = rankCandidates(
      {
        likedTags: taste.likedTags,
        dislikedTags: taste.dislikedTags,
        likedAuthors: taste.likedAuthors,
        dislikedAuthors: taste.dislikedAuthors
      },
      candidates,
      { excludeBookIds: [...excluded], limit }
    );
    return { picks, searchedTags, excludedBookIds: [...excluded].sort() };
  }
  /** 更新读者口味标签（喜好/雷点），生成新口味版本；内容不变就不动 */
  async updateReaderTags(readerId, likedTags, dislikedTags) {
    const patch = {
      likedTags: this.normalizeTasteWeights(likedTags.map((tagId) => ({ tagId, weight: 0.5 }))),
      dislikedTags: this.normalizeTasteWeights(dislikedTags.map((tagId) => ({ tagId, weight: 0.8 })))
    };
    return this.updateTasteProfile(readerId, patch);
  }
  /** 评论区学习：只返回分布与风格提示，不保留任何评论原文 */
  async learnFromComments(bookId, chapterId) {
    assertSafeId(bookId, "bookId");
    assertSafeId(chapterId, "chapterId");
    if (!this.source) throw new Error("\u6CA1\u6709\u914D\u7F6E\u4E66\u6E90\uFF08L1/L2\uFF09\uFF0C\u8BFB\u4E0D\u5230\u8BC4\u8BBA\u533A");
    const comments = await this.source.fetchComments(bookId, chapterId);
    const evidence = distillCommentEvidence(comments);
    return { evidence, hints: commentStyleHints(evidence) };
  }
  /** 今天还能开几个新书任务、轮到谁（自动模式只在谷时） */
  async planSlots(mode) {
    const readers = (await this.listReaders()).filter((r) => r.status === "active");
    const quota = await this.quota();
    const ratings = await this.listRatings();
    const lastServed = /* @__PURE__ */ new Map();
    for (const rating of ratings) {
      const previous = lastServed.get(rating.readerId);
      if (!previous || previous < rating.createdAt) lastServed.set(rating.readerId, rating.createdAt);
    }
    return planNewBookSlots({
      now: this.clock(),
      tzOffsetMinutes: this.tzOffsetMinutes,
      mode,
      limits: quota.limits.global,
      usage: quota.global,
      readerLimit: quota.limits.reader,
      readers: readers.map((reader) => ({
        readerId: reader.id,
        usage: quota.readers[reader.id],
        lastServedAt: lastServed.get(reader.id)
      }))
    });
  }
  /* -------------------------------- 评分 ------------------------------- */
  ratingsDir(readerId) {
    assertSafeId(readerId, "readerId");
    return this.safePath("readers", readerId, "ratings");
  }
  async saveRating(draft) {
    return this.withWriteLock(async () => {
      const rating = await this.checkRating(draft);
      await writeJson(this.safePath("readers", rating.readerId, "ratings", `${rating.id}.json`), rating);
      return rating;
    });
  }
  /** 评分前置校验（不写盘）：字段、目标章节、指纹/版本、口味版本、评审链顺序 */
  async checkRating(draft) {
    const reader = await this.requireReader(draft.readerId);
    if (reader.status !== "active") throw new Error(`\u8BFB\u8005 ${reader.id} \u5F53\u524D\u4E0D\u662F active\uFF0C\u4E0D\u80FD\u8BC4\u5206`);
    const rating = buildRating({ ...draft, now: draft.now ?? this.clock().toISOString() });
    const kind = rating.target.kind;
    if (kind !== "external" && kind !== "manuscript") {
      throw new Error(`\u8BC4\u5206\u76EE\u6807\u7C7B\u578B\u975E\u6CD5\uFF1A${String(kind)}\uFF08\u53EA\u5141\u8BB8 external / manuscript\uFF09`);
    }
    if (kind === "manuscript" && (!Number.isInteger(rating.target.chapterNumber) || rating.target.chapterNumber < 1)) {
      throw new Error("\u4F5C\u8005\u7A3F\u8BC4\u5206\u5FC5\u987B\u5E26\u5408\u6CD5\u7684\u7AE0\u8282\u53F7 chapterNumber");
    }
    if (kind === "external" && !rating.target.sourceId) {
      throw new Error("\u5916\u90E8\u4F5C\u54C1\u8BC4\u5206\u5FC5\u987B\u5E26 sourceId");
    }
    assertSafeId(rating.target.bookId, "bookId");
    assertSafeId(rating.target.chapterId, "chapterId");
    const chapter = await this.getChapter(rating.target.bookId, rating.target.chapterId);
    if (!chapter) throw new Error(`\u8BC4\u5206\u7684\u7AE0\u8282\u4E0D\u5B58\u5728\uFF1A${rating.target.bookId}/${rating.target.chapterId}`);
    if (chapter.contentHash !== rating.target.contentHash) {
      throw new Error("\u8BC4\u5206\u76EE\u6807\u7684\u6B63\u6587\u6307\u7EB9\u4E0E\u5F53\u524D\u7AE0\u8282\u4E0D\u4E00\u81F4\uFF08\u53EF\u80FD\u5DF2\u6539\u7A3F\uFF09\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BC4");
    }
    if (rating.target.kind === "manuscript") {
      if (rating.target.revision !== chapter.revision) {
        throw new Error(`\u8BC4\u5206\u76EE\u6807\u7684\u7A3F\u4EF6\u7248\u672C ${rating.target.revision} \u4E0E\u5F53\u524D\u7248\u672C ${chapter.revision} \u4E0D\u4E00\u81F4`);
      }
      if (rating.target.chapterNumber !== chapter.sequenceNumber) {
        throw new Error(`\u8BC4\u5206\u76EE\u6807\u7684\u7AE0\u8282\u53F7 ${rating.target.chapterNumber} \u4E0E\u7AE0\u8282\u5B9E\u9645\u5E8F\u53F7 ${chapter.sequenceNumber} \u4E0D\u4E00\u81F4`);
      }
      if (chapter.sequenceNumber > 1) {
        const memory = await this.getReviewMemory(reader.id, rating.target.bookId);
        if (!memory) throw new Error(`\u8FD8\u6CA1\u6709\u8BC4\u5BA1\u94FE\u8BB0\u5FC6\uFF0C\u4E0D\u80FD\u76F4\u63A5\u8BC4\u7B2C ${chapter.sequenceNumber} \u7AE0`);
        if (memory.validThrough !== chapter.sequenceNumber - 1) {
          throw new Error(
            `\u8BC4\u5BA1\u94FE\u6709\u6548\u8BFB\u5230\u7B2C ${memory.validThrough} \u7AE0\uFF0C\u53EA\u80FD\u8BC4\u7B2C ${memory.validThrough + 1} \u7AE0\uFF08\u8BF7\u6C42\u7B2C ${chapter.sequenceNumber} \u7AE0\uFF09`
          );
        }
      }
    }
    const taste = await this.getTaste(reader.id, rating.tasteVersion);
    if (!taste) throw new Error(`\u5F15\u7528\u4E0D\u5B58\u5728\u7684\u53E3\u5473\u7248\u672C\uFF1A${rating.tasteVersion}`);
    return rating;
  }
  async listRatings(query = {}) {
    const readers = query.readerId ? [await this.requireReader(query.readerId)] : await this.listReaders();
    const out = [];
    for (const reader of readers) {
      for (const file of await listJsonFiles(this.ratingsDir(reader.id))) {
        const rating = await readJsonOptional(file);
        if (!rating) continue;
        if (query.bookId && rating.target.bookId !== query.bookId) continue;
        if (query.chapterId && rating.target.chapterId !== query.chapterId) continue;
        out.push(rating);
      }
    }
    return out.sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
  }
  /** 同一章的多读者分歧（只读聚合，不返回任何读者记忆） */
  async compareChapter(input) {
    const chapter = await this.getChapter(input.bookId, input.chapterId);
    if (!chapter) throw new Error(`\u7AE0\u8282\u4E0D\u5B58\u5728\uFF1A${input.bookId}/${input.chapterId}`);
    const readers = await this.listReaders();
    const wanted = input.readerIds ? readers.filter((r) => input.readerIds.includes(r.id)) : readers;
    const items = [];
    for (const reader of wanted) {
      const ratings = await this.listRatings({ readerId: reader.id, bookId: input.bookId, chapterId: input.chapterId });
      const rating = ratings.find(
        (r) => r.target.contentHash === chapter.contentHash && (r.target.kind !== "manuscript" || r.target.revision === input.revision)
      );
      if (!rating) continue;
      items.push({
        readerId: reader.id,
        readerName: reader.name,
        tasteVersion: rating.tasteVersion,
        revision: rating.target.kind === "manuscript" ? rating.target.revision : input.revision,
        stars: rating.stars,
        chapterComment: rating.chapterComment,
        segmentComments: rating.segmentComments
      });
    }
    return compareRatings({ bookId: input.bookId, chapterId: input.chapterId, targetRevision: input.revision, items });
  }
  /* -------------------------------- 记忆 ------------------------------- */
  readingMemoryFile(readerId, bookId) {
    assertSafeId(bookId, "bookId");
    return this.safePath("readers", readerId, "memory", "reading", `${bookId}.json`);
  }
  reviewMemoryFile(readerId, bookId) {
    assertSafeId(bookId, "bookId");
    return this.safePath("readers", readerId, "memory", "review", `${bookId}.json`);
  }
  async getReadingMemory(readerId, bookId) {
    return readJsonStrict(this.readingMemoryFile(readerId, bookId));
  }
  async saveReadingMemory(memory) {
    assertSafeId(memory.readerId, "readerId");
    const current = await this.getReader(memory.readerId);
    if (!current) throw new Error(`\u8BFB\u8005\u4E0D\u5B58\u5728\uFF1A${memory.readerId}`);
    await writeJson(this.readingMemoryFile(memory.readerId, memory.bookId), memory);
  }
  async getReviewMemory(readerId, bookId) {
    return readJsonStrict(this.reviewMemoryFile(readerId, bookId));
  }
  async saveReviewMemory(memory) {
    assertSafeId(memory.readerId, "readerId");
    const current = await this.getReader(memory.readerId);
    if (!current) throw new Error(`\u8BFB\u8005\u4E0D\u5B58\u5728\uFF1A${memory.readerId}`);
    await writeJson(this.reviewMemoryFile(memory.readerId, memory.bookId), memory);
  }
  /**
   * 按序读一章：校验顺序 → 校验配额 → 更新该读者的阅读记忆 → 记账。
   * v0.2 阶段记忆内容由调用方给出（模拟或真实引擎产出）；这里只负责一致性与边界。
   */
  async readChapter(input) {
    const reader = await this.requireReader(input.readerId);
    if (reader.status !== "active") throw new Error(`\u8BFB\u8005 ${reader.id} \u5F53\u524D\u4E0D\u662F active\uFF0C\u4E0D\u80FD\u9605\u8BFB`);
    const chapter = await this.getChapter(input.bookId, input.chapterId);
    if (!chapter) throw new Error(`\u7AE0\u8282\u4E0D\u5B58\u5728\uFF1A${input.bookId}/${input.chapterId}`);
    return this.withWriteLock(async () => {
      await this.ensureJournalClean();
      if (input.requestId) {
        const requestId = this.assertSafeRequestId(input.requestId);
        const receipt = await readJsonStrict(
          this.safePath("receipts", `${requestId}.json`)
        );
        if (receipt) return receipt.result;
      }
      const previous = await this.getReadingMemory(reader.id, input.bookId) ?? emptyReadingMemory(reader.id, input.bookId);
      assertNextReadingChapter(previous.readThrough, chapter.sequenceNumber);
      const estimateTokens = Math.ceil(chapter.wordCount * 2);
      const tokens = input.tokens === void 0 ? estimateTokens : input.tokens;
      if (tokens !== null && (!Number.isFinite(tokens) || tokens < 0)) {
        throw new Error(`token \u7528\u91CF\u5FC5\u987B\u662F\u975E\u8D1F\u6709\u9650\u6570\uFF0C\u6536\u5230 ${String(tokens)}`);
      }
      const ledgerTokens = tokens ?? estimateTokens;
      const unknown = input.tokens === null;
      const quota = await this.quota();
      const delta = { chapters: 1, words: chapter.wordCount, tokens: ledgerTokens };
      const check = checkQuota(quota.limits.global, quota.global, delta);
      const readerCheck = checkQuota(quota.limits.reader, quota.readers[reader.id] ?? emptyUsage(), delta);
      const exceeded = check.ok ? readerCheck : check;
      if (!exceeded.ok) {
        throw new ReaderLimitError("LIMIT_EXCEEDED", exceeded.message ?? "\u4ECA\u65E5\u914D\u989D\u5DF2\u7528\u5B8C", { exceeded: exceeded.exceeded });
      }
      const now = this.clock().toISOString();
      const patch = input.memoryPatch ?? {};
      const memory = {
        ...previous,
        characters: patch.characters ?? previous.characters,
        expectations: patch.expectations ?? previous.expectations,
        emotionalTone: patch.emotionalTone ?? previous.emotionalTone,
        unreadQuestions: patch.unreadQuestions ?? previous.unreadQuestions,
        droppedReason: patch.droppedReason ?? previous.droppedReason,
        readThrough: chapter.sequenceNumber,
        fatigueCounter: input.stars ? nextFatigue(previous.fatigueCounter, input.stars) : previous.fatigueCounter,
        updatedAt: now
      };
      const run = {
        schemaVersion: 2,
        seq: this.nextSeq(),
        txId: randomUUID2(),
        kind: "read-chapter",
        at: now,
        readerId: reader.id,
        bookId: input.bookId,
        memory,
        usage: { date: this.localDate(), delta: { chapters: 1, words: chapter.wordCount, tokens: ledgerTokens, unknown } },
        requestId: input.requestId
      };
      await writeJournalRun(this.root, run);
      return this.applyJournalRun(run);
    });
  }
  /**
   * 真实评审：模型读第 N 章 → 严格校验 → 一次修复 → 评分 + 阅读记忆 + 评审链记忆 + 配额一次提交。
   * 只评审作者稿（manuscript）；外部公开页只有短摘录，不能作为完整正文评审。
   */
  async reviewChapter(input) {
    const port = input.port ?? this.reviewPort;
    if (!port) throw new Error("\u6CA1\u6709\u914D\u7F6E\u8BC4\u5BA1\u6A21\u578B\u7AEF\u53E3\uFF08reviewPort\uFF09\uFF0C\u53EA\u80FD\u4F7F\u7528\u6A21\u62DF\u8BFB\u8005");
    const reader = await this.requireReader(input.readerId);
    if (reader.status !== "active") throw new Error(`\u8BFB\u8005 ${reader.id} \u5F53\u524D\u4E0D\u662F active\uFF0C\u4E0D\u80FD\u8BC4\u5BA1`);
    const chapter = await this.getChapter(input.bookId, input.chapterId);
    if (!chapter) throw new Error(`\u7AE0\u8282\u4E0D\u5B58\u5728\uFF1A${input.bookId}/${input.chapterId}`);
    if (chapter.contentOrigin === "public-page") {
      throw new Error("\u516C\u5F00\u9875\u53EA\u4FDD\u5B58\u4E86\u77ED\u6458\u5F55\uFF0C\u4E0D\u80FD\u505A\u5B8C\u6574\u8BC4\u5BA1\uFF1B\u8BF7\u7528\u5BFC\u5165\u7684\u7A3F\u4EF6");
    }
    const taste = await this.getTaste(reader.id);
    if (!taste) throw new Error(`\u8BFB\u8005 ${reader.id} \u6CA1\u6709\u53E3\u5473\u6863\u6848`);
    const content = await this.getChapterContent(input.bookId, input.chapterId, chapter.revision);
    if (!content) throw new Error(`\u7AE0\u8282\u6B63\u6587\u7F3A\u5931\uFF1A${input.bookId}/${input.chapterId} r${chapter.revision}`);
    const reviewMemory = await this.getReviewMemory(reader.id, input.bookId);
    assertReviewOrder(reviewMemory, chapter.sequenceNumber, reviewMemory?.generation ?? 1);
    if (input.requestId) {
      const requestId = this.assertSafeRequestId(input.requestId);
      const receipt = await readJsonStrict(this.safePath("receipts", `${requestId}.json`));
      if (receipt?.result?.rating && receipt.result.memory && receipt.result.usage && receipt.result.reviewMemory) {
        return {
          rating: receipt.result.rating,
          memory: receipt.result.memory,
          reviewMemory: receipt.result.reviewMemory,
          usage: receipt.result.usage,
          repaired: false
        };
      }
    }
    const estimateTokens = Math.ceil(chapter.wordCount * 2);
    const quota = await this.quota();
    const precheckDelta = { chapters: 1, words: chapter.wordCount, tokens: estimateTokens };
    const globalCheck = checkQuota(quota.limits.global, quota.global, precheckDelta);
    const readerCheck = checkQuota(quota.limits.reader, quota.readers[reader.id] ?? emptyUsage(), precheckDelta);
    const exceeded = globalCheck.ok ? readerCheck : globalCheck;
    if (!exceeded.ok) {
      throw new ReaderLimitError("LIMIT_EXCEEDED", exceeded.message ?? "\u4ECA\u65E5\u914D\u989D\u5DF2\u7528\u5B8C", { exceeded: exceeded.exceeded });
    }
    const generated = await generateReview(
      port,
      {
        reader,
        taste,
        reviewMemory,
        bookId: input.bookId,
        chapterId: input.chapterId,
        chapterNumber: chapter.sequenceNumber,
        title: chapter.title,
        content
      },
      { signal: input.signal }
    );
    const providerUsage = generated.response.usage;
    const tokensKnown = providerUsage.inputTokens !== null && providerUsage.outputTokens !== null;
    const totalTokens = tokensKnown ? providerUsage.inputTokens + providerUsage.outputTokens : estimateTokens;
    const now = this.clock().toISOString();
    const target = ratingTargetFor({
      bookId: input.bookId,
      chapterId: input.chapterId,
      contentHash: chapter.contentHash,
      sequenceNumber: chapter.sequenceNumber,
      revision: chapter.revision
    });
    const draftRating = buildRating(
      draftToRating(
        generated.draft,
        {
          readerId: reader.id,
          target,
          tasteVersion: taste.version,
          providerId: port.id,
          model: generated.response.model || port.model
        },
        providerUsage
      )
    );
    const memory = mergeReviewMemory(await this.getReadingMemory(reader.id, input.bookId) ?? emptyReadingMemory(reader.id, input.bookId), generated.draft, {
      bookId: input.bookId,
      sequenceNumber: chapter.sequenceNumber
    }, now);
    const nextReviewMemory = advanceReviewMemory(
      reviewMemory,
      generated.draft,
      { bookId: input.bookId, readerId: reader.id, chapterNumber: chapter.sequenceNumber },
      now
    );
    return this.withWriteLock(async () => {
      await this.ensureJournalClean();
      if (input.requestId) {
        const requestId = this.assertSafeRequestId(input.requestId);
        const receipt = await readJsonStrict(this.safePath("receipts", `${requestId}.json`));
        if (receipt?.result?.rating && receipt.result.memory && receipt.result.usage && receipt.result.reviewMemory) {
          return {
            rating: receipt.result.rating,
            memory: receipt.result.memory,
            reviewMemory: receipt.result.reviewMemory,
            usage: receipt.result.usage,
            repaired: false
          };
        }
      }
      const latestReview = await this.getReviewMemory(reader.id, input.bookId);
      assertReviewOrder(latestReview, chapter.sequenceNumber, latestReview?.generation ?? 1);
      const latestQuota = await this.quota();
      const latestGlobal = checkQuota(latestQuota.limits.global, latestQuota.global, { chapters: 1, words: chapter.wordCount, tokens: totalTokens });
      const latestReader = checkQuota(latestQuota.limits.reader, latestQuota.readers[reader.id] ?? emptyUsage(), { chapters: 1, words: chapter.wordCount, tokens: totalTokens });
      const latestExceeded = latestGlobal.ok ? latestReader : latestGlobal;
      if (!latestExceeded.ok) {
        throw new ReaderLimitError("LIMIT_EXCEEDED", latestExceeded.message ?? "\u4ECA\u65E5\u914D\u989D\u5DF2\u7528\u5B8C", { exceeded: latestExceeded.exceeded });
      }
      const run = {
        schemaVersion: 2,
        seq: this.nextSeq(),
        txId: randomUUID2(),
        kind: "review-chapter",
        at: now,
        readerId: reader.id,
        bookId: input.bookId,
        memory,
        rating: draftRating,
        reviewMemoryAfter: nextReviewMemory,
        usage: {
          date: this.localDate(new Date(now)),
          delta: { chapters: 1, words: chapter.wordCount, tokens: totalTokens, unknown: !tokensKnown }
        },
        requestId: input.requestId
      };
      await writeJournalRun(this.root, run);
      const applied = await this.applyJournalRun(run);
      return {
        rating: draftRating,
        memory: applied.memory,
        reviewMemory: nextReviewMemory,
        usage: applied.usage,
        repaired: generated.repaired
      };
    });
  }
  /** 由当日评分汇总生成日报（不写文件），格式见 reader 的 renderDailyReport */
  async buildDailyReport(date = this.localDate()) {
    this.assertDate(date);
    const ratings = await this.listRatings();
    const byBook = /* @__PURE__ */ new Map();
    for (const rating of ratings) {
      if (this.localDateOf(rating.createdAt) !== date) continue;
      const key = `${rating.target.bookId}`;
      const current = byBook.get(key);
      if (!current || current.createdAt < rating.createdAt) byBook.set(key, rating);
    }
    const entries = [];
    for (const rating of byBook.values()) {
      const book = await this.getBook(rating.target.bookId);
      const chapter = await this.getChapter(rating.target.bookId, rating.target.chapterId);
      entries.push({
        bookId: rating.target.bookId,
        title: book?.title ?? rating.target.bookId,
        author: book?.author,
        readToChapter: chapter?.sequenceNumber ?? 1,
        stars: rating.stars,
        status: rating.status,
        note: rating.chapterComment,
        segmentComments: rating.segmentComments.length,
        dropReasonCode: rating.dropReasonCode
      });
    }
    return renderDailyReport(date, entries);
  }
  /* -------------------------------- 配额 ------------------------------- */
  quotaFile(date) {
    this.assertDate(date);
    return this.safePath("quota", `${date}.json`);
  }
  localDate(at = this.clock()) {
    const shifted = new Date(at.getTime() + this.tzOffsetMinutes * 6e4);
    return shifted.toISOString().slice(0, 10);
  }
  /** 把任意 ISO 时间换算成本地日期（日报按本地日期归档） */
  localDateOf(iso) {
    const at = new Date(iso);
    return this.localDate(Number.isNaN(at.getTime()) ? this.clock() : at);
  }
  async readQuotaStored(date) {
    return readJsonStrict(this.quotaFile(date));
  }
  async quota(date = this.localDate()) {
    const stored = await this.readQuotaStored(date);
    return {
      date,
      global: stored?.global ?? emptyUsage(),
      readers: stored?.readers ?? {},
      limits: { global: this.globalQuota, reader: this.readerQuota }
    };
  }
  async addUsage(readerId, delta) {
    return this.withWriteLock(() => this.addUsageLocked(readerId, delta));
  }
  async addUsageLocked(readerId, delta, txId, date = this.localDate()) {
    assertSafeId(readerId, "readerId");
    for (const [key, value] of Object.entries(delta)) {
      if (key === "tokens") continue;
      if (value !== void 0 && (!Number.isFinite(value) || value < 0)) {
        throw new Error(`\u914D\u989D\u589E\u91CF ${key} \u5FC5\u987B\u662F\u975E\u8D1F\u6709\u9650\u6570\uFF0C\u6536\u5230 ${String(value)}`);
      }
    }
    if (delta.tokens !== void 0 && delta.tokens !== null && (!Number.isFinite(delta.tokens) || delta.tokens < 0)) {
      throw new Error(`\u914D\u989D\u589E\u91CF tokens \u5FC5\u987B\u662F\u975E\u8D1F\u6709\u9650\u6570\u6216 null\uFF0C\u6536\u5230 ${String(delta.tokens)}`);
    }
    const stored = await this.readQuotaStored(date);
    const appliedTx = stored?.appliedTx ?? [];
    if (txId && appliedTx.includes(txId)) {
      return {
        date,
        global: stored?.global ?? emptyUsage(),
        readers: stored?.readers ?? {},
        limits: { global: this.globalQuota, reader: this.readerQuota }
      };
    }
    const global = addUsage(stored?.global ?? emptyUsage(), delta);
    const reader = addUsage(stored?.readers?.[readerId] ?? emptyUsage(), delta);
    const readers = { ...stored?.readers ?? {}, [readerId]: reader };
    const nextTx = txId ? [...appliedTx, txId].slice(-2e3) : appliedTx;
    await writeJson(this.quotaFile(date), { date, global, readers, appliedTx: nextTx });
    return { date, global, readers, limits: { global: this.globalQuota, reader: this.readerQuota } };
  }
  /* -------------------------------- 报告 ------------------------------- */
  async writeReport(date, markdown) {
    this.assertDate(date);
    const file = this.safePath("reports", `${date}.md`);
    await atomicWrite(file, markdown);
    return file;
  }
  async readReport(date) {
    this.assertDate(date);
    const file = this.safePath("reports", `${date}.md`);
    if (!existsSync3(file)) return null;
    const { readFile: readFile5 } = await import("node:fs/promises");
    return readFile5(file, "utf8");
  }
  /** 数据根（测试与 UI 用） */
  get dataRoot() {
    return this.root;
  }
  /** 读者数据摘要（不含任何正文/记忆内容） */
  async summary(readerId) {
    const reader = await this.getReader(readerId);
    if (!reader) return null;
    const ratings = await this.listRatings({ readerId });
    const books = new Set(ratings.map((r) => r.target.bookId));
    return { reader, books: books.size, ratings: ratings.length, tasteVersion: reader.tasteVersion };
  }
  /** 内部：给迁移模块用的根 */
  get workspace() {
    return this.workspaceRoot;
  }
  /** 内部：内容指纹短串（测试/调试） */
  hash(text) {
    return shortHash(text);
  }
};

// src/adapter/migration.ts
import path4 from "node:path";
import { copyFile, mkdir as mkdir4, open as open2, readFile as readFile4, readdir as readdir4, unlink as unlink4 } from "node:fs/promises";
import { existsSync as existsSync4 } from "node:fs";
var LEGACY_DIR = "legacy";
var RECORD_FILE = "migration-v01.json";
async function sha256File(file) {
  return sha256Hex(await readFile4(file, "utf8"));
}
async function collectSources(root) {
  const out = [];
  const profiles = path4.join(root, "profiles.json");
  if (existsSync4(profiles)) out.push({ path: "profiles.json", sha256: await sha256File(profiles) });
  const reviewsDir = path4.join(root, "reviews");
  if (existsSync4(reviewsDir)) {
    const names = (await readdir4(reviewsDir)).filter((n) => n.endsWith(".json")).sort();
    for (const name of names) {
      out.push({ path: `reviews/${name}`, sha256: await sha256File(path4.join(reviewsDir, name)) });
    }
  }
  return out;
}
function hashPlan(sources) {
  return sha256Hex(sources.map((s) => `${s.path}:${s.sha256}`).join("\n"));
}
async function readRecord(root) {
  const file = path4.join(root, LEGACY_DIR, RECORD_FILE);
  if (!existsSync4(file)) return null;
  try {
    return JSON.parse(await readFile4(file, "utf8"));
  } catch {
    return null;
  }
}
async function planLegacyMigration(workspaceRoot) {
  const root = path4.join(workspaceRoot, READER_DATA_DIR);
  const sources = await collectSources(root);
  const planHash = hashPlan(sources);
  const record = await readRecord(root);
  const blocked = [];
  const reviews = sources.filter((s) => s.path.startsWith("reviews/")).length;
  const profiles = sources.some((s) => s.path === "profiles.json") ? 1 : 0;
  const unverifiable = reviews;
  if (reviews > 0) {
    blocked.push("\u65E7\u8BC4\u5BA1\u53EA\u505A\u5F52\u6863\uFF08legacy-unverifiable\uFF09\uFF0C\u4E0D\u4F1A\u6298\u7B97\u6210\u661F\u7EA7\uFF0C\u4E5F\u4E0D\u4F1A\u751F\u6210\u8BB0\u5FC6");
  }
  if (sources.length === 0) {
    blocked.push("\u6CA1\u6709\u627E\u5230 v0.1 \u6570\u636E\uFF08profiles.json / reviews/\uFF09");
  }
  return {
    planHash,
    sourceRoot: root,
    profiles,
    reviews,
    unverifiable,
    alreadyMigrated: record !== null && record.planHash === planHash,
    blocked,
    sources
  };
}
async function applyLegacyMigration(workspaceRoot, planHash) {
  const root = path4.join(workspaceRoot, READER_DATA_DIR);
  const plan = await planLegacyMigration(workspaceRoot);
  if (plan.planHash !== planHash) {
    return {
      applied: false,
      planHash,
      archived: 0,
      manifestPath: null,
      reason: "\u6E90\u6587\u4EF6\u5728 plan \u4E4B\u540E\u53D1\u751F\u53D8\u5316\uFF0C\u8FC1\u79FB\u4E2D\u6B62\uFF08\u8BF7\u91CD\u65B0 plan\uFF09"
    };
  }
  if (plan.sources.length === 0) {
    return { applied: false, planHash, archived: 0, manifestPath: null, reason: "\u6CA1\u6709\u53EF\u8FC1\u79FB\u7684 v0.1 \u6570\u636E" };
  }
  const record = await readRecord(root);
  if (record && record.planHash === planHash) {
    return { applied: false, planHash, archived: 0, manifestPath: null, reason: "\u540C\u4E00\u8BA1\u5212\u5DF2\u8FC1\u79FB\u8FC7\uFF08\u5E42\u7B49\u8FD4\u56DE\uFF09" };
  }
  const legacyRoot = path4.join(root, LEGACY_DIR, "v0.1");
  const lockFile = path4.join(root, LEGACY_DIR, ".migration.lock");
  await mkdir4(path4.dirname(lockFile), { recursive: true });
  let lockHandle;
  try {
    lockHandle = await open2(lockFile, "wx");
  } catch {
    return { applied: false, planHash, archived: 0, manifestPath: null, reason: "\u53E6\u4E00\u4E2A\u8FC1\u79FB\u6B63\u5728\u8FDB\u884C\uFF0C\u62D2\u7EDD\u5E76\u53D1\u6267\u884C" };
  }
  try {
    if (existsSync4(legacyRoot)) {
      const existing = await readdir4(legacyRoot).catch(() => []);
      if (existing.length > 0) {
        return {
          applied: false,
          planHash,
          archived: 0,
          manifestPath: null,
          reason: "legacy/v0.1 \u5DF2\u6709\u5F52\u6863\u5FEB\u7167\uFF0C\u62D2\u7EDD\u8986\u76D6\uFF08\u4E0D\u540C\u8BA1\u5212\u8BF7\u53E6\u5EFA\u76EE\u5F55\uFF0C\u6216\u4EBA\u5DE5\u786E\u8BA4\u540E\u6E05\u7406\uFF09"
        };
      }
    }
    await mkdir4(legacyRoot, { recursive: true });
    let archived = 0;
    for (const source of plan.sources) {
      const from = path4.join(root, source.path);
      const to = path4.join(legacyRoot, source.path);
      await mkdir4(path4.dirname(to), { recursive: true });
      await copyFile(from, to);
      if (await sha256File(to) !== source.sha256) {
        return {
          applied: false,
          planHash,
          archived,
          manifestPath: null,
          reason: `\u5F52\u6863\u526F\u672C\u54C8\u5E0C\u4E0E\u8BA1\u5212\u4E0D\u4E00\u81F4\uFF1A${source.path}\uFF08\u590D\u5236\u671F\u95F4\u6E90\u53EF\u80FD\u53D8\u5316\uFF09`
        };
      }
      archived++;
    }
    const manifestPath = path4.join(root, LEGACY_DIR, RECORD_FILE);
    const manifest = {
      schemaVersion: 2,
      planHash,
      at: (/* @__PURE__ */ new Date()).toISOString(),
      note: "v0.1 \u6570\u636E\u5DF2\u539F\u6837\u5907\u4EFD\uFF1B\u65E7\u8BC4\u5BA1\u6807\u4E3A legacy-unverifiable\uFF0C\u4E0D\u6298\u7B97\u6210\u661F\u7EA7",
      sources: plan.sources
    };
    await mkdir4(path4.dirname(manifestPath), { recursive: true });
    const { writeFile: writeFile2 } = await import("node:fs/promises");
    await writeFile2(manifestPath, `${JSON.stringify(manifest, null, 2)}
`, "utf8");
    return { applied: true, planHash, archived, manifestPath };
  } finally {
    await lockHandle.close().catch(() => void 0);
    await unlink4(lockFile).catch(() => void 0);
  }
}

// src/adapter/adapter.ts
import { existsSync as existsSync5 } from "node:fs";
import path5 from "node:path";
var READER_DESCRIPTOR = {
  name: "reader",
  version: "0.2.0",
  dataDir: ".dsh-novel-comment",
  capabilities: ["read", "review", "rate", "taste", "quota", "report"]
};
function toReaderFail(error) {
  if (error instanceof ReaderLimitError) return fail(error.code, error.message, error.details);
  if (error instanceof RatingValidationError) return fail("VALIDATION_FAILED", error.message, { field: error.field });
  if (error instanceof ReadingOrderError) {
    return fail("CONFLICT", error.message, { expectedSequence: error.expectedSequence, actualSequence: error.actualSequence });
  }
  if (error instanceof StorageError) return fail("IO_ERROR", error.message, { file: error.file });
  if (error instanceof SourceStopError) return fail("UPSTREAM_ERROR", error.message, { reason: error.reason });
  const message = error instanceof Error ? error.message : String(error);
  return fail("IO_ERROR", message);
}
var ReaderAdapter = class {
  descriptor = READER_DESCRIPTOR;
  service;
  constructor(service) {
    this.service = service;
  }
  async query(req) {
    const input = req.input ?? {};
    try {
      switch (req.query) {
        case "readers.list": {
          const readers = await this.service.listReaders();
          const summaries = await Promise.all(readers.map((r) => this.service.summary(r.id)));
          return ok({ readers: summaries.filter((s) => s !== null) });
        }
        case "reader.get": {
          const reader = await this.service.getReader(String(input.readerId));
          if (!reader) return fail("NOT_FOUND", `\u8BFB\u8005\u4E0D\u5B58\u5728\uFF1A${String(input.readerId)}`);
          const taste = await this.service.getTaste(reader.id);
          return ok({ reader, taste });
        }
        case "books.list": {
          return ok({ books: await this.service.listBooks() });
        }
        case "chapter.get": {
          const content = await this.service.getChapterContent(String(input.bookId), String(input.chapterId), input.revision);
          if (content === null) return fail("NOT_FOUND", "\u7AE0\u8282\u6216\u7248\u672C\u4E0D\u5B58\u5728");
          const meta = await this.service.getChapter(String(input.bookId), String(input.chapterId));
          return ok({ meta, content });
        }
        case "ratings.list": {
          const ratings = await this.service.listRatings({
            readerId: input.readerId,
            bookId: input.bookId,
            chapterId: input.chapterId
          });
          return ok({ ratings });
        }
        case "comparison.get": {
          const comparison = await this.service.compareChapter({
            bookId: String(input.bookId),
            chapterId: String(input.chapterId),
            revision: Number(input.revision),
            readerIds: input.readerIds
          });
          return ok(comparison);
        }
        case "quota.get": {
          return ok(await this.service.quota(input.date));
        }
        case "report.get": {
          const date = String(input.date);
          const markdown = await this.service.readReport(date);
          if (markdown === null) return fail("NOT_FOUND", `\u6CA1\u6709 ${date} \u7684\u65E5\u62A5`);
          return ok({ date, markdown });
        }
        case "report.preview": {
          const date = input.date ?? this.service.localDate();
          return ok({ date, markdown: await this.service.buildDailyReport(date) });
        }
        case "source.search": {
          return ok({ results: await this.service.searchSource(input) });
        }
        case "discover.recommend": {
          return ok(await this.service.discoverForReader(String(input.readerId), input.limit ?? 3));
        }
        case "comments.learn": {
          return ok(await this.service.learnFromComments(String(input.bookId), String(input.chapterId)));
        }
        case "schedule.plan": {
          const mode = input.mode === "manual" ? "manual" : "auto";
          return ok(await this.service.planSlots(mode));
        }
        default:
          return fail("UNSUPPORTED", `\u672A\u5B9E\u73B0\u7684\u67E5\u8BE2\uFF1A${req.query}`);
      }
    } catch (error) {
      return toReaderFail(error);
    }
  }
  async command(req) {
    const input = req.input ?? {};
    try {
      switch (req.command) {
        case "reader.create": {
          const reader = input.templateId ? await this.service.createReaderFromTemplate(String(input.templateId), input.name) : await this.service.createReader({
            name: String(input.name),
            persona: String(input.persona),
            personaTemplateId: input.personaTemplateId
          });
          return ok(reader);
        }
        case "reader.status": {
          return ok(await this.service.setReaderStatus(String(input.readerId), input.status));
        }
        case "book.import": {
          return ok(await this.service.importBook(input));
        }
        case "book.importFromUrl": {
          return ok(
            await this.service.importFromUrl({
              url: String(input.url),
              bookId: String(input.bookId),
              chapterId: String(input.chapterId),
              sequenceNumber: Number(input.sequenceNumber),
              title: input.title
            })
          );
        }
        case "chapter.import": {
          if (req.dryRun) {
            return ok({ dryRun: true, bookId: input.bookId, chapterId: input.chapterId });
          }
          return ok(await this.service.importChapter(input));
        }
        case "chapter.read": {
          return ok(
            await this.service.readChapter({
              readerId: String(input.readerId),
              bookId: String(input.bookId),
              chapterId: String(input.chapterId),
              stars: input.stars,
              tokens: input.tokens,
              memoryPatch: input.memoryPatch,
              requestId: input.requestId
            })
          );
        }
        case "review.start": {
          if (req.dryRun) {
            return ok({ dryRun: true, bookId: input.bookId, chapterId: input.chapterId });
          }
          return ok(
            await this.service.reviewChapter({
              readerId: String(input.readerId),
              bookId: String(input.bookId),
              chapterId: String(input.chapterId),
              requestId: input.requestId
            })
          );
        }
        case "rating.save": {
          if (req.dryRun) {
            const rating = await this.service.checkRating(input);
            return ok({ dryRun: true, ratingId: rating.id });
          }
          return ok(await this.service.saveRating(input));
        }
        case "taste.update": {
          const taste = await this.service.updateTasteProfile(
            String(input.readerId),
            input.patch ?? {},
            input.evidenceRatingIds ?? []
          );
          return ok(taste);
        }
        case "report.write": {
          const file = await this.service.writeReport(String(input.date), String(input.markdown));
          return ok({ file });
        }
        case "quota.add": {
          return ok(
            await this.service.addUsage(String(input.readerId), {
              newBooks: input.newBooks,
              chapters: input.chapters,
              words: input.words,
              tokens: input.tokens
            })
          );
        }
        default:
          return fail("UNSUPPORTED", `\u672A\u5B9E\u73B0\u7684\u547D\u4EE4\uFF1A${req.command}`);
      }
    } catch (error) {
      return toReaderFail(error);
    }
  }
  async validate(req) {
    const problems = [];
    const name = req.validation ?? "workspace";
    try {
      if (name === "workspace") {
        const formatFile = path5.join(this.service.dataRoot, "format.json");
        if (!existsSync5(formatFile)) {
          problems.push({ path: "format.json", message: "\u6570\u636E\u6839\u5C1A\u672A\u521D\u59CB\u5316\uFF08\u6CA1\u6709 format.json\uFF09" });
        } else {
          const readers = await this.service.listReaders(true);
          if (readers.length > this.service.limits.maxReaders) {
            problems.push({ path: "readers", message: `\u8BFB\u8005\u6570\u91CF ${readers.length} \u8D85\u8FC7\u4E0A\u9650 ${this.service.limits.maxReaders}` });
          }
        }
      } else if (name === "reader") {
        const readerId = String(req.input?.readerId ?? "");
        if (!await this.service.getReader(readerId)) problems.push({ path: "readerId", message: `\u8BFB\u8005\u4E0D\u5B58\u5728\uFF1A${readerId}` });
      } else if (name === "rating") {
        const draft = req.input ?? {};
        if (draft.stars === void 0) problems.push({ path: "stars", message: "\u7F3A\u5C11\u661F\u7EA7" });
      } else {
        problems.push({ path: "validation", message: `\u672A\u77E5\u6821\u9A8C\u9879\uFF1A${name}` });
      }
    } catch (error) {
      problems.push({ path: "workspace", message: error instanceof Error ? error.message : String(error) });
    }
    return { ok: problems.length === 0, problems };
  }
};

// src/adapter/openai-compatible.ts
var OpenAICompatibleProvider = class {
  id;
  model;
  config;
  constructor(config) {
    this.config = config;
    this.id = config.id ?? "openai-compatible";
    this.model = config.model;
  }
  async generate(request, options) {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 6e4);
    const onAbort = () => controller.abort();
    options?.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetchImpl(`${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {},
          ...this.config.extraHeaders ?? {}
        },
        body: JSON.stringify({
          model: request.model && request.model !== "reviewer" ? request.model : this.model,
          messages: request.messages,
          temperature: 0.7,
          max_tokens: this.config.maxOutputTokens ?? request.maxOutputTokens,
          response_format: { type: "json_object" },
          stream: false
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 200);
        throw new Error(`\u6A21\u578B\u8C03\u7528\u5931\u8D25\uFF1AHTTP ${response.status}${detail ? ` \xB7 ${detail}` : ""}`);
      }
      const payload = await response.json();
      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) throw new Error("\u6A21\u578B\u8FD4\u56DE\u7A7A\u5185\u5BB9");
      const usage = {
        inputTokens: typeof payload.usage?.prompt_tokens === "number" ? payload.usage.prompt_tokens : null,
        outputTokens: typeof payload.usage?.completion_tokens === "number" ? payload.usage.completion_tokens : null,
        source: payload.usage ? "provider" : "unknown"
      };
      return { text, model: payload.model ?? this.model, usage };
    } finally {
      clearTimeout(timer);
      options?.signal?.removeEventListener("abort", onAbort);
    }
  }
};
export {
  FORMAT_FILE,
  FakeSource,
  OpenAICompatibleProvider,
  READER_DATA_DIR,
  READER_DESCRIPTOR,
  ReaderAdapter,
  ReaderService,
  STORAGE_FORMAT,
  StorageError,
  TAG_ALIASES,
  TAG_CATEGORIES,
  applyLegacyMigration,
  atomicWrite,
  canonicalTag,
  ensureLayout,
  extractTitle,
  fakeReview,
  htmlToText,
  listJsonFiles,
  planLegacyMigration,
  readJsonOptional,
  readJsonStrict,
  readPublicPage,
  readerRoot,
  resolveTag,
  tagCatalog,
  tagsByCategory,
  toReaderFail,
  writeJson
};
