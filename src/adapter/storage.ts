import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/** reader 自己的数据根；除了这里，什么都不写 */
export const READER_DATA_DIR = ".dsh-novel-comment";

export const FORMAT_FILE = "format.json";

export interface StorageFormat {
  schemaVersion: 2;
  storage: "reader-v2";
  textNormalization: "lf-v1";
  paragraphProtocol: "blank-line-v1";
}

export const STORAGE_FORMAT: StorageFormat = {
  schemaVersion: 2,
  storage: "reader-v2",
  textNormalization: "lf-v1",
  paragraphProtocol: "blank-line-v1",
};

export class StorageError extends Error {
  readonly file: string;

  constructor(file: string, message: string) {
    super(message);
    this.name = "StorageError";
    this.file = file;
  }
}

/** 原子写：唯一临时文件 + rename；中断只会留下临时文件，不会留下半个 JSON */
export async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, content, "utf8");
  try {
    await rename(tmp, file);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** 可选文件：不存在返回 null；存在但坏了返回 null（列表场景用） */
export async function readJsonOptional<T>(file: string): Promise<T | null> {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** 权威文件：不存在返回 null；存在但坏了抛 StorageError（不能静默当成没有） */
export async function readJsonStrict<T>(file: string): Promise<T | null> {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    throw new StorageError(file, `文件损坏，无法解析：${file}（${(error as Error).message}）`);
  }
}

export async function listJsonFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  return names.filter((n) => n.endsWith(".json")).map((n) => path.join(dir, n)).sort();
}

export function readerRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, READER_DATA_DIR);
}

export async function ensureLayout(workspaceRoot: string): Promise<string> {
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
