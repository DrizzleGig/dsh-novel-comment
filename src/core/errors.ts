/** 统一错误码 — 所有插件适配器共用 */
export type ErrorCode =
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "FORBIDDEN"
  | "IO_ERROR"
  | "UNSUPPORTED"
  | "LIMIT_EXCEEDED"
  | "UPSTREAM_ERROR";

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail(code: ErrorCode, message: string, details?: unknown): Result<never> {
  return { ok: false, error: { code, message, details } };
}

/** 可直接抛出的错误（适配器内部使用，边界处转成 Result） */
export class PluginError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "PluginError";
    this.code = code;
    this.details = details;
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof PluginError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  return { code: "IO_ERROR", message: err instanceof Error ? err.message : String(err) };
}
