import type { PluginName } from "./domain.ts";
import type { Result } from "./errors.ts";

/**
 * PluginAdapter — 前端与插件之间的唯一通道。
 *
 * 职责：
 * - Query   ：只读查询，返回 DTO
 * - Command ：写操作，必须校验；dryRun 时只校验不落盘
 * - Validate：检查插件数据是否合法 / 是否就绪
 *
 * 前端不得直接读写 `.dsh-novel-*` 目录，也不得依赖插件内部状态机。
 */

export interface QueryRequest<TInput = unknown> {
  plugin: PluginName;
  query: string;
  input?: TInput;
}

export interface CommandRequest<TInput = unknown> {
  plugin: PluginName;
  command: string;
  input: TInput;
  /** 只校验不落盘 */
  dryRun?: boolean;
}

export interface ValidateRequest {
  plugin: PluginName;
  /** 具体校验项；省略等价于各插件的 workspace 校验 */
  validation?: string;
  input?: unknown;
}

export interface Problem {
  path: string;
  message: string;
}

export interface ValidateResult {
  ok: boolean;
  problems: Problem[];
}

export interface PluginAdapter {
  query<T = unknown>(req: QueryRequest): Promise<Result<T>>;
  command<T = unknown>(req: CommandRequest): Promise<Result<T>>;
  validate(req: ValidateRequest): Promise<ValidateResult>;
}

export interface PluginDescriptor {
  name: PluginName;
  version: string;
  /** 相对工作区根的数据目录 */
  dataDir: string;
  /** 该插件对外暴露的能力名，用于 UI 判断可挂载哪些面板 */
  capabilities: string[];
}
