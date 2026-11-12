import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { readAppEnvValue, readProjectAuthToken } from "../src/index.ts";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("项目口令统一按进程、根目录、旧应用配置顺序读取", () => {
  const root = mkdtempSync(join(tmpdir(), "nana-auth-env-"));
  roots.push(root);
  mkdirSync(join(root, "apps", "site"), { recursive: true });
  vi.stubEnv("NANA_AUTH_TOKEN", "");
  vi.stubEnv("NANA_SITE_CONFIG_TOKEN", "");
  writeFileSync(join(root, "apps/site/.env"), "NANA_SITE_CONFIG_TOKEN=legacy-token-123456\n");
  expect(readProjectAuthToken(root)).toBe("legacy-token-123456");
  writeFileSync(join(root, ".env"), "NANA_AUTH_TOKEN=project-token-123456\n");
  expect(readProjectAuthToken(root)).toBe("project-token-123456");
  vi.stubEnv("NANA_AUTH_TOKEN", "environment-token-123456");
  expect(readProjectAuthToken(root)).toBe("environment-token-123456");
});

test("应用环境变量按应用隔离，支持引号与注释，不写入进程环境", () => {
  const root = mkdtempSync(join(tmpdir(), "nana-app-env-"));
  roots.push(root);
  for (const app of ["bot", "site"]) mkdirSync(join(root, "apps", app), { recursive: true });
  vi.stubEnv("NANA_TEST_ENV_KEY", "");
  writeFileSync(
    join(root, "apps", "bot", ".env"),
    'export NANA_TEST_ENV_KEY=" bot-value " # comment\n',
  );
  writeFileSync(join(root, "apps", "site", ".env"), "NANA_TEST_ENV_KEY='site-value'\n");
  expect(readAppEnvValue("bot", "NANA_TEST_ENV_KEY", root)).toBe("bot-value");
  expect(readAppEnvValue("site", "NANA_TEST_ENV_KEY", root)).toBe("site-value");
  expect(process.env.NANA_TEST_ENV_KEY).toBe("");
  vi.stubEnv("NANA_TEST_ENV_KEY", " process-value ");
  expect(readAppEnvValue("bot", "NANA_TEST_ENV_KEY", root)).toBe("process-value");
});

test("应用未提供变量或 .env 时返回 undefined", () => {
  const root = mkdtempSync(join(tmpdir(), "nana-app-env-"));
  roots.push(root);
  vi.stubEnv("NANA_TEST_ENV_KEY", "");
  expect(readAppEnvValue("bot", "NANA_TEST_ENV_KEY", root)).toBeUndefined();
  mkdirSync(join(root, "apps", "bot"), { recursive: true });
  writeFileSync(join(root, "apps", "bot", ".env"), "OTHER=value\n");
  expect(readAppEnvValue("bot", "NANA_TEST_ENV_KEY", root)).toBeUndefined();
});
