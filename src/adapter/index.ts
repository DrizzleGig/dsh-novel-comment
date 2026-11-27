export {
  READER_DATA_DIR,
  FORMAT_FILE,
  STORAGE_FORMAT,
  StorageError,
  atomicWrite,
  writeJson,
  readJsonOptional,
  readJsonStrict,
  listJsonFiles,
  readerRoot,
  ensureLayout,
} from "./storage.ts";
export type { StorageFormat } from "./storage.ts";
export { ReaderService } from "./service.ts";
export type {
  ReaderServiceOptions,
  CreateReaderInput,
  ImportBookInput,
  ImportChapterInput,
  ImportChapterResult,
  QuotaSnapshot,
} from "./service.ts";
export { planLegacyMigration, applyLegacyMigration } from "./migration.ts";
export type { MigrationPlan, MigrationResult } from "./migration.ts";
export { fakeReview, FakeSource } from "../reader/index.ts";
export { tagCatalog, canonicalTag, resolveTag, TAG_CATEGORIES, TAG_ALIASES, tagsByCategory } from "../reader/index.ts";
export type { TagCatalog, TagCategory } from "../reader/index.ts";
export type { FakeReviewInput } from "../reader/index.ts";
export { ReaderAdapter, READER_DESCRIPTOR, toReaderFail } from "./adapter.ts";
export { readPublicPage, extractTitle, htmlToText } from "./page-reader.ts";
export type { PublicPageConfig, PublicPageResult } from "./page-reader.ts";
export { OpenAICompatibleProvider } from "./openai-compatible.ts";
export type { OpenAICompatibleConfig } from "./openai-compatible.ts";
