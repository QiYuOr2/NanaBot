import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { resolveProjectRoot } from "./project.ts";
import { ENV_KEYS } from "@nana/constants";

/** 全项目共用口令：进程环境 > 根目录 .env；兼容原 site / bot 口令。 */
export function readProjectAuthToken(rootDir?: string): string | undefined {
  const fromProcess = process.env[ENV_KEYS.NANA_AUTH_TOKEN]?.trim();
  if (fromProcess) return fromProcess;
  try {
    const value = parseEnv(readFileSync(join(resolveProjectRoot(rootDir), ".env"), "utf8"))[
      ENV_KEYS.NANA_AUTH_TOKEN
    ]?.trim();
    if (value) return value;
  } catch {
    // 未迁移到根目录 .env 时继续使用已有口令。
  }
  return (
    readAppEnvValue("site", ENV_KEYS.NANA_SITE_CONFIG_TOKEN, rootDir) ??
    readAppEnvValue("bot", ENV_KEYS.NANA_SITE_CONFIG_TOKEN, rootDir)
  );
}

/** 优先读取进程变量，再读取指定应用的 .env；不修改进程环境。 */
export function readAppEnvValue(
  app: "bot" | "site",
  key: string,
  rootDir?: string,
): string | undefined {
  const value = process.env[key]?.trim();
  if (value) return value;
  try {
    return (
      parseEnv(readFileSync(join(resolveProjectRoot(rootDir), "apps", app, ".env"), "utf8"))[
        key
      ]?.trim() || undefined
    );
  } catch {
    return undefined;
  }
}

export function readOptionalNumberEnv(key: string): number | undefined {
  const value = process.env[key];

  if (!value) {
    return undefined;
  }

  const numberValue = Number(value);

  if (Number.isNaN(numberValue)) {
    throw new Error(`${key} 必须是有效数字。`);
  }

  return numberValue;
}
