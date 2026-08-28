import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { dump, load } from "js-yaml";
import { setDeepPath } from "@nana/utils";
import type { StorageOptions, StoragePath, StorageValue } from "./types.ts";
import { resolveDbPath } from "./paths.ts";

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
  setDeepPath(store, path, value);
  return writeStore(fileName, store, options);
}
