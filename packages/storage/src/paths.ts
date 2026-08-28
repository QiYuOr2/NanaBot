import { isAbsolute, join } from "node:path";
import { DATABASE_DIRECTORY } from "@nana/constants";
import { resolveProjectRoot } from "@nana/utils";
import type { StorageOptions } from "./types.ts";

function normalizeFileName(fileName: string): string {
  if (!fileName || isAbsolute(fileName) || fileName.includes("..")) {
    throw new Error("存储文件名必须是 db 目录下的相对路径。");
  }

  return fileName;
}

export function resolveDbPath(fileName: string, options?: StorageOptions): string {
  return join(
    resolveProjectRoot(options?.rootDir),
    DATABASE_DIRECTORY,
    normalizeFileName(fileName),
  );
}
