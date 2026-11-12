import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { LOG_DIRECTORY } from "@nana/constants";
import { resolveProjectRoot } from "@nana/utils";
import { createError } from "h3";
import type { ProjectLogFile, ProjectLogsResponse } from "../../shared/logs.ts";

const MAX_BYTES = 256 * 1024;
const MAX_FILES = 500;
const logName = /\.(?:log|txt|out|err)(?:\.\d+)?$/i;
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

export async function readProjectLogs(
  requested?: string,
  lines = 500,
  rootDir?: string,
): Promise<ProjectLogsResponse> {
  const directory = join(resolveProjectRoot(rootDir), LOG_DIRECTORY);
  const files: ProjectLogFile[] = [];
  const response = {
    files,
    selected: null,
    content: "",
    truncated: false,
    generatedAt: new Date().toISOString(),
  };
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw createError({ statusCode: 400, statusMessage: "日志目录必须是项目内的真实目录" });
  } catch (error) {
    if (isMissing(error)) return response;
    throw error;
  }
  async function walk(folder: string, depth: number): Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (files.length >= MAX_FILES) return;
      const path = join(folder, entry.name);
      if (entry.isDirectory() && depth < 5) await walk(path, depth + 1);
      if (!entry.isFile() || !logName.test(entry.name)) continue;
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) continue;
        files.push({
          name: relative(directory, path).split(sep).join("/"),
          size: info.size,
          updatedAt: info.mtime.toISOString(),
        });
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
  }
  await walk(directory, 0);
  files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
  const selected = requested ?? files[0]?.name;
  if (!selected) return response;
  if (!files.some((file) => file.name === selected))
    throw createError({ statusCode: 400, statusMessage: "请选择有效的日志文件" });
  const path = join(directory, selected);
  // 校验真实路径，拒绝目录穿越以及符号链接跳出 logs/。
  const inside = relative(await realpath(directory), await realpath(path));
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
    throw createError({ statusCode: 400, statusMessage: "日志路径无效" });
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw createError({ statusCode: 400, statusMessage: "日志文件无效" });
    const start = Math.max(0, info.size - MAX_BYTES);
    const buffer = Buffer.alloc(Math.min(info.size, MAX_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    let content = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) {
      const newline = content.indexOf("\n");
      content = newline < 0 ? "" : content.slice(newline + 1);
    }
    const allLines = content.replace(/\n$/, "").split("\n");
    const limit = Math.max(1, Math.min(2000, Number.isFinite(lines) ? Math.floor(lines) : 500));
    return {
      files,
      selected,
      content: allLines.slice(-limit).join("\n"),
      truncated: start > 0 || allLines.length > limit,
      generatedAt: new Date().toISOString(),
    };
  } finally {
    await handle.close();
  }
}
