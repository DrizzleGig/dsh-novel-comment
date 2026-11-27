export { sha256Hex, shortHash } from "./hash.ts";
export { isSafeId, assertSafeId, slugify } from "./ids.ts";
export { ReaderLimitError, resolveReaderLimits, assertCanCreateReader, checkQuota, addUsage, emptyUsage } from "./limits.ts";
export type { QuotaCheck } from "./limits.ts";
export { createInitialTaste, updateTaste, computeTasteVersion, tasteContentKey } from "./taste.ts";
export type { InitialTasteInput, TastePatch } from "./taste.ts";
export {
  buildRating,
  validateStars,
  validateStatus,
  validateDropReason,
  validateSegmentComments,
  RatingValidationError,
  STAR_MEANING,
  MAX_CHAPTER_COMMENT,
  MAX_SEGMENT_COMMENT,
  MAX_SEGMENTS,
  MAX_QUOTE,
} from "./rating.ts";
export type { RatingDraft } from "./rating.ts";
export { splitParagraphs, normalizeWithMap, locateAnchor, buildLocator, hasDuplicateQuote, PARAGRAPH_PROTOCOL } from "./locate.ts";
export type { LocatedAnchor } from "./locate.ts";
export {
  DEFAULT_PEAK_WINDOWS,
  isPeak,
  classifyMoment,
  momentFromDate,
  canAutoRunAt,
} from "./valley.ts";
export type { PeakWindow, Moment, ValleyClass } from "./valley.ts";
export {
  assertNextReadingChapter,
  assertReviewOrder,
  measureMemory,
  assertMemoryBounds,
  nextFatigue,
  shouldDrop,
  emptyReadingMemory,
  MEMORY_LIMITS,
  ReadingOrderError,
} from "./reading.ts";
export type { MemoryMeasure, TokenCountKind } from "./reading.ts";
export { compareRatings } from "./comparison.ts";
export type { ComparisonResult } from "./comparison.ts";
export { renderDailyReport } from "./report.ts";
export type { DailyReportEntry, DailyReportSkipped } from "./report.ts";
export { READER_PERSONA_TEMPLATES } from "./personas.ts";
export type { ReaderPersonaTemplate } from "./personas.ts";
export { fakeReview } from "./fake.ts";
export type { FakeReviewInput } from "./fake.ts";
export { TAG_CATEGORIES, TAG_ALIASES, canonicalTag, normalizeTags, tagCatalog, resolveTag, tagOverlap, tagsByCategory } from "./tags.ts";
export type { TagCategory, TagCatalog } from "./tags.ts";
export { rankCandidates } from "./discover.ts";
export type { CandidateBook, DiscoverTaste, DiscoveredBook, RankOptions } from "./discover.ts";
export { planNewBookSlots } from "./scheduler.ts";
export type { ReaderScheduleState, ScheduleDecision, ScheduleInput } from "./scheduler.ts";
export { distillCommentEvidence, commentStyleHints } from "./comments.ts";
export type { RawComment, CommentEvidence } from "./comments.ts";
export { SourceStopError } from "./source.ts";
export type { BookSearch, ChapterFetch, SearchResult, SourceAdapter } from "./source.ts";
export { FakeSource } from "./fake-source.ts";
export {
  buildReviewPrompt,
  extractJsonObject,
  parseReviewDraft,
  generateReview,
  draftToRating,
  mergeReviewMemory,
  advanceReviewMemory,
  ratingTargetFor,
  ReviewModelError,
} from "./review-engine.ts";
export type {
  ReviewModelPort,
  ReviewModelRequest,
  ReviewModelResponse,
  ReviewPromptInput,
  ReviewDraft,
  ReviewMemoryCandidate,
  GeneratedReview,
  ReviewCommitContext,
} from "./review-engine.ts";
