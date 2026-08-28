import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { NANA_CONFIG_FILE } from "@nana/constants";

/** 定位项目根目录：优先使用 rootDir，否则从当前目录向上查找配置标记文件。 */
export function resolveProjectRoot(rootDir?: string): string {
  if (rootDir) {
    return resolve(rootDir);
  }

  let currentDir = resolve(process.cwd());

  while (true) {
    if (existsSync(join(currentDir, NANA_CONFIG_FILE))) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);

    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  throw new Error(
    `找不到项目根目录标记 ${NANA_CONFIG_FILE}。请从项目目录启动，或通过 rootDir 指定项目根目录。`,
  );
}
