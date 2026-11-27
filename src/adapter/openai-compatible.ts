import type { TokenUsage } from "../core/index.ts";
import type { ReviewModelPort, ReviewModelRequest, ReviewModelResponse } from "../reader/index.ts";

/**
 * OpenAI 兼容端点（BYOK）：只做「结构化评审」这一种调用。
 * 宿主 / DSH 壳可注入别的实现；这里不存 Key、不写日志正文。
 */
export interface OpenAICompatibleConfig {
  id?: string;
  /** 例如 https://api.deepseek.com/v1 */
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
  extraHeaders?: Record<string, string>;
}

export class OpenAICompatibleProvider implements ReviewModelPort {
  readonly id: string;
  readonly model: string;
  private readonly config: OpenAICompatibleConfig;

  constructor(config: OpenAICompatibleConfig) {
    this.config = config;
    this.id = config.id ?? "openai-compatible";
    this.model = config.model;
  }

  async generate(request: ReviewModelRequest, options?: { signal?: AbortSignal }): Promise<ReviewModelResponse> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 60_000);
    const onAbort = () => controller.abort();
    options?.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetchImpl(`${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
          ...(this.config.extraHeaders ?? {}),
        },
        body: JSON.stringify({
          model: request.model && request.model !== "reviewer" ? request.model : this.model,
          messages: request.messages,
          temperature: 0.7,
          max_tokens: this.config.maxOutputTokens ?? request.maxOutputTokens,
          response_format: { type: "json_object" },
          stream: false,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 200);
        throw new Error(`模型调用失败：HTTP ${response.status}${detail ? ` · ${detail}` : ""}`);
      }
      const payload = (await response.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) throw new Error("模型返回空内容");
      const usage: TokenUsage = {
        inputTokens: typeof payload.usage?.prompt_tokens === "number" ? payload.usage.prompt_tokens : null,
        outputTokens: typeof payload.usage?.completion_tokens === "number" ? payload.usage.completion_tokens : null,
        source: payload.usage ? "provider" : "unknown",
      };
      return { text, model: payload.model ?? this.model, usage };
    } finally {
      clearTimeout(timer);
      options?.signal?.removeEventListener("abort", onAbort);
    }
  }
}
