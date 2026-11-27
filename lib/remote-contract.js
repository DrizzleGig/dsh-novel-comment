/**
 * Typert remote contract for the AI 读者 sidebar.
 * Mirrored in client.js — keep both copies in sync.
 */

const scalar = (validate) => ({
  parse(value) {
    validate(value);
    return value;
  },
  safeParse(value) {
    try {
      validate(value);
      return { success: true, data: value };
    } catch (error) {
      return { success: false, error };
    }
  },
});

const sessionIdSchema = scalar((v) => {
  if (typeof v !== "string" || v.length === 0) throw new Error("sessionId must be a non-empty string");
});
const jsonObjectSchema = scalar((v) => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("options must be a JSON object");
});
const resultSchema = scalar((v) => {
  if (v === null || typeof v !== "object") throw new Error("result must be a JSON object");
});

const codec = (typeSymbol, schema) => ({ mode: "strict", typeSymbol, create: () => schema });
const param = (name, schema) => ({ name, wire: name, source: "json", codec: codec(name, schema) });
const invocation = (method, params) => ({
  id: `dsh-novel-comment#readerPanel/${method}`,
  namespace: "readerPanel",
  service: "readerPanel",
  method,
  invocation: { kind: "direct" },
  parameters: [param("sessionId", sessionIdSchema), ...params],
  result: codec("ReaderResult", resultSchema),
});

export const DESCRIPTORS = [
  invocation("status", []),
  invocation("createReader", [param("options", jsonObjectSchema)]),
  invocation("importChapter", [param("options", jsonObjectSchema)]),
  invocation("rateChapter", [param("options", jsonObjectSchema)]),
  invocation("reviewChapter", [param("options", jsonObjectSchema)]),
  invocation("report", [param("options", jsonObjectSchema)]),
  invocation("discover", [param("options", jsonObjectSchema)]),
  invocation("importUrl", [param("options", jsonObjectSchema)]),
  invocation("tags", []),
  invocation("search", [param("options", jsonObjectSchema)]),
  invocation("updateTaste", [param("options", jsonObjectSchema)]),
];
