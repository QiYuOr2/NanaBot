import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dump, load } from "js-yaml";
import { NANA_CONFIG_FILE } from "@nana/constants";
import { resolveProjectRoot, setDeepPath } from "@nana/utils";

export type NanaConfig = Record<string, unknown>;

export function resolveConfigPath(): string {
  return join(resolveProjectRoot(), NANA_CONFIG_FILE);
}

export function readConfig<T extends NanaConfig = NanaConfig>(): T {
  const configPath = resolveConfigPath();
  const config = load(readFileSync(configPath, "utf8"));

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`${NANA_CONFIG_FILE} 的根节点必须是对象。`);
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
  setDeepPath(config, path, value);
  return writeConfig(config);
}
