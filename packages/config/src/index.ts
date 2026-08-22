import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { dump, load } from "js-yaml";

export const configFileName = "nana.config.yaml";

export type NanaConfig = Record<string, unknown>;

export function resolveConfigPath(): string {
  let currentDir = resolve(process.cwd());

  while (true) {
    const configPath = join(currentDir, configFileName);

    if (existsSync(configPath)) {
      return configPath;
    }

    const parentDir = dirname(currentDir);

    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  throw new Error(`找不到 ${configFileName}。请从项目目录启动，或通过 rootDir 指定项目根目录。`);
}

export function readConfig<T extends NanaConfig = NanaConfig>(): T {
  const configPath = resolveConfigPath();
  const config = load(readFileSync(configPath, "utf8"));

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`${configFileName} 的根节点必须是对象。`);
  }

  return config as T;
}

export function writeConfig(config: NanaConfig): string {
  const configPath = resolveConfigPath();
  writeFileSync(configPath, dump(config, { noRefs: true, lineWidth: -1 }), "utf8");
  return configPath;
}

export function updateConfig(path: string | readonly (string | number)[], value: unknown): string {
  const config = readConfig();
  const segments = typeof path === "string" ? path.split(".").filter(Boolean) : path;

  if (segments.length === 0) {
    throw new Error("配置路径不能为空。");
  }

  let target: Record<string | number, unknown> = config;

  for (const segment of segments.slice(0, -1)) {
    const next = target[segment];

    if (!next || typeof next !== "object" || Array.isArray(next)) {
      target[segment] = {};
    }

    target = target[segment] as Record<string | number, unknown>;
  }

  target[segments.at(-1)!] = value;
  return writeConfig(config);
}
