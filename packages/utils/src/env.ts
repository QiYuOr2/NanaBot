import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { resolveProjectRoot } from "./project.ts";

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
