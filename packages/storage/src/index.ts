import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { dump, load } from "js-yaml";

export type StorageValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
export type StoragePath = string | readonly (string | number)[];

export interface StorageOptions {
  rootDir?: string;
}

const rootMarker = "nana.config.yaml";
const databaseDirectory = "db";

function resolveRootDir(rootDir?: string): string {
  if (rootDir) {
    return resolve(rootDir);
  }

  let currentDir = resolve(process.cwd());

  while (true) {
    if (existsSync(join(currentDir, rootMarker))) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);

    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  throw new Error(
    `找不到项目根目录标记 ${rootMarker}。请从项目目录启动，或通过 rootDir 指定项目根目录。`,
  );
}

function normalizeFileName(fileName: string): string {
  if (!fileName || isAbsolute(fileName) || fileName.includes("..")) {
    throw new Error("存储文件名必须是 db 目录下的相对路径。");
  }

  return fileName;
}

export function resolveDbPath(fileName: string, options?: StorageOptions): string {
  return join(resolveRootDir(options?.rootDir), databaseDirectory, normalizeFileName(fileName));
}

export function readStore<T extends StorageValue = StorageValue>(
  fileName: string,
  options?: StorageOptions,
): T | undefined {
  const filePath = resolveDbPath(fileName, options);

  if (!existsSync(filePath)) {
    return undefined;
  }

  const content = readFileSync(filePath, "utf8");

  if (!content.trim()) {
    return undefined;
  }

  const value = load(content);
  return value as T | undefined;
}

export function writeStore<T extends StorageValue>(
  fileName: string,
  value: T,
  options?: StorageOptions,
): string {
  const filePath = resolveDbPath(fileName, options);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, dump(value, { noRefs: true, lineWidth: -1 }), "utf8");
  return filePath;
}

export function updateStore(
  fileName: string,
  path: StoragePath,
  value: unknown,
  options?: StorageOptions,
): string {
  const store = (readStore<Record<string | number, unknown>>(fileName, options) ?? {}) as Record<
    string | number,
    unknown
  >;
  const segments = typeof path === "string" ? path.split(".").filter(Boolean) : path;

  if (segments.length === 0) {
    throw new Error("存储路径不能为空。");
  }

  let target = store;

  for (const segment of segments.slice(0, -1)) {
    const next = target[segment];

    if (!next || typeof next !== "object" || Array.isArray(next)) {
      target[segment] = {};
    }

    target = target[segment] as Record<string | number, unknown>;
  }

  target[segments.at(-1)!] = value;
  return writeStore(fileName, store, options);
}
