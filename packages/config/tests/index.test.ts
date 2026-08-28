import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { NANA_CONFIG_FILE } from "@nana/constants";
import { readConfig, resolveConfigPath, updateConfig } from "../src/index.ts";

test("从子目录启动时定位项目根目录配置", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-config-"));
  const configPath = join(rootDir, NANA_CONFIG_FILE);
  mkdirSync(join(rootDir, "apps", "bot"), { recursive: true });
  writeFileSync(configPath, "up:\n  live: false\n", "utf8");
  const originalCwd = process.cwd();

  try {
    process.chdir(join(rootDir, "apps", "bot"));

    expect(resolveConfigPath()).toBe(configPath);
    expect(readConfig()).toEqual({ up: { live: false } });
  } finally {
    process.chdir(originalCwd);
  }
});

test("按路径更新并写回 YAML 配置", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-config-"));
  const originalCwd = process.cwd();
  process.chdir(rootDir);
  writeFileSync(NANA_CONFIG_FILE, "monitor:\n  enabled: false\n", "utf8");

  try {
    updateConfig("monitor.enabled", true);

    expect(readConfig()).toEqual({ monitor: { enabled: true } });
    expect(readFileSync(NANA_CONFIG_FILE, "utf8")).toContain("enabled: true");
  } finally {
    process.chdir(originalCwd);
  }
});
