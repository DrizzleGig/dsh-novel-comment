import { lookup } from "node:dns/promises";
import { SourceStopError } from "../reader/index.ts";

/**
 * L2 通用「公开网页」读取器（不做站点评分/搜索，只把用户给的公开页读成正文）。
 *
 * 红线：
 * - 只允许配置里的站点（精确匹配 host），**每一跳重定向都重新校验**；
 * - 默认拒绝本机/私网地址（DNS 解析后校验），防重定向与 DNS 重绑定绕过；
 * - 只读公开页面：403/429/验证码/风控字样一律停止，不重试、不换代理；
 * - 流式读取、有大小上限与全程超时；只返回正文文本，不落盘、不存 HTML。
 */
export interface PublicPageConfig {
  /** 允许访问的 host（精确匹配，不含端口） */
  allowedHosts: string[];
  /** 页面大小上限（字节，默认 512 KB） */
  maxBytes?: number;
  /** 全程超时（毫秒，默认 10s） */
  timeoutMs?: number;
  /** 允许本机/私网（只给测试用，产品默认关闭） */
  allowPrivateHosts?: boolean;
  /** 测试注入 */
  fetchImpl?: typeof fetch;
  /** 测试注入 DNS 解析 */
  lookupImpl?: (hostname: string) => Promise<Array<{ address: string }>>;
}

export interface PublicPageResult {
  url: string;
  host: string;
  title: string;
  text: string;
  bytes: number;
}

const CAPTCHA_MARKERS = ["验证码", "captcha", "人机验证", "滑动验证", "安全验证"];
const PAYWALL_MARKERS = ["本章为付费章节", "购买本章", "订阅本章", "登录后阅读"];
const MAX_REDIRECTS = 3;

export async function readPublicPage(rawUrl: string, config: PublicPageConfig): Promise<PublicPageResult> {
  const maxBytes = config.maxBytes ?? 512 * 1024;
  const timeoutMs = config.timeoutMs ?? 10_000;
  const fetchImpl = config.fetchImpl ?? fetch;
  const lookupImpl = config.lookupImpl ?? ((hostname: string) => lookup(hostname, { all: true }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = parseUrl(rawUrl);
    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertUrlAllowed(current, config, lookupImpl);
      response = await fetchImpl(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "user-agent": "MaguaNovel-reader/0.2 (+personal reading)" },
      });
      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new SourceStopError("unsupported", "重定向缺少 Location");
        current = parseUrl(new URL(location, current).toString());
        continue;
      }
      break;
    }
    if (!response) throw new SourceStopError("temporarily_unavailable", "没有拿到响应");
    if (isRedirect(response.status)) throw new SourceStopError("unsupported", "重定向次数过多，停止");

    assertStatus(response.status);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new SourceStopError("unsupported", `不支持的内容类型：${contentType || "unknown"}`);
    }

    const body = await readBoundedBody(response, maxBytes);
    const bytes = new TextEncoder().encode(body).length;
    const lower = body.toLowerCase();
    if (CAPTCHA_MARKERS.some((m) => lower.includes(m.toLowerCase()))) {
      throw new SourceStopError("captcha", "页面出现验证码，停止（请人工处理）");
    }
    if (PAYWALL_MARKERS.some((m) => lower.includes(m.toLowerCase()))) {
      throw new SourceStopError("paywall", "页面提示需要付费/登录，停止");
    }
    return { url: current.toString(), host: current.hostname, title: extractTitle(body), text: htmlToText(body), bytes };
  } finally {
    clearTimeout(timer);
  }
}

function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SourceStopError("unsupported", `不是合法的 URL：${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SourceStopError("unsupported", `只支持 http/https，收到 ${url.protocol}`);
  }
  if (url.username || url.password) throw new SourceStopError("unsupported", "URL 里不允许带账号密码");
  return url;
}

async function assertUrlAllowed(
  url: URL,
  config: PublicPageConfig,
  lookupImpl: (hostname: string) => Promise<Array<{ address: string }>>,
): Promise<void> {
  if (!config.allowedHosts.includes(url.hostname)) {
    throw new SourceStopError("unsupported", `站点不在允许列表：${url.hostname}`);
  }
  if (config.allowPrivateHosts) return;
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookupImpl(url.hostname);
  } catch {
    throw new SourceStopError("temporarily_unavailable", `域名解析失败：${url.hostname}`);
  }
  if (addresses.length === 0) throw new SourceStopError("temporarily_unavailable", `域名没有解析结果：${url.hostname}`);
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new SourceStopError("unsupported", `拒绝访问本机/私网地址：${url.hostname} → ${address}`);
    }
  }
}

export function isPrivateAddress(address: string): boolean {
  let value = address.toLowerCase();
  if (value === "::1" || value === "::") return true;
  // IPv4-mapped IPv6：::ffff:127.0.0.1 / ::ffff:7f00:1
  if (value.startsWith("::ffff:")) {
    const rest = value.slice("::ffff:".length);
    if (rest.includes(".")) return isPrivateAddress(rest);
    const groups = rest.split(":");
    if (groups.length === 2) {
      const high = Number.parseInt(groups[0]!, 16);
      const low = Number.parseInt(groups[1]!, 16);
      if (Number.isFinite(high) && Number.isFinite(low)) {
        value = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
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

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function assertStatus(status: number): void {
  if (status === 401 || status === 403) {
    throw new SourceStopError("paywall", `站点返回 ${status}，需要登录或付费，停止`);
  }
  if (status === 429) throw new SourceStopError("rate_limited", "站点限速（429），本轮停止");
  if (status >= 300 && status < 400) throw new SourceStopError("unsupported", `未处理的重定向状态：${status}`);
  if (status < 200 || status >= 300) throw new SourceStopError("temporarily_unavailable", `站点返回 ${status}`);
}

/** 流式读取，边读边卡上限；超过上限立即中止 */
async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new SourceStopError("unsupported", `页面超过大小上限（> ${maxBytes} 字节）`);
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

export function extractTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1]!.replace(/\s+/g, " ").trim()) : "";
}

/** 极简 HTML→文本：去掉脚本/样式/标签，保留段落换行；不做正文提取算法 */
export function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const withBreaks = withoutScripts
    .replace(/<\/(p|div|h[1-6]|li|br|section|article)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, "");
  return decodeEntities(stripped)
    .split("\n")
    .map((line) => line.replace(/[ \t\u3000]+/g, " ").trim())
    .filter((line, index, all) => line.length > 0 || all[index - 1]?.length !== 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
