import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { accountLogPath, botLogPath, createLoggerManager } from "../src/core/logger.ts";

function createRootDir(): string {
  return mkdtempSync(join(tmpdir(), "nana-bot-logs-"));
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("进程日志与每个 QQ 账号的日志分别落盘", () => {
  const rootDir = createRootDir();
  const logs = createLoggerManager({
    rootDir,
    console: false,
    now: () => new Date("2026-11-11T12:00:00Z"),
  });

  logs.root.info("进程启动");
  logs.root.error("主进程错误", new Error("boom"));
  logs.account("2799397589", "主号").info("主号连接成功");
  logs.account("2227511984", "饭总号").warn("饭总号等待 NapCat");

  expect(read(botLogPath(rootDir))).toContain("进程启动");
  expect(read(botLogPath(rootDir))).toContain("主进程错误");
  expect(read(botLogPath(rootDir))).toContain("boom");

  const mainLog = read(accountLogPath(rootDir, "2799397589"));
  expect(mainLog).toContain("[NanaBot:主号] 主号连接成功");
  expect(mainLog).not.toContain("饭总号");

  const fanLog = read(accountLogPath(rootDir, "2227511984"));
  expect(fanLog).toContain("[NanaBot:饭总号] 饭总号等待 NapCat");
  expect(fanLog).not.toContain("主号连接成功");
});

test("日志超过大小上限时轮转并保留配置数量的历史文件", () => {
  const rootDir = createRootDir();
  const logs = createLoggerManager({
    rootDir,
    console: false,
    maxBytes: 120,
    maxFiles: 2,
    now: () => new Date("2026-11-11T12:00:00Z"),
  });

  for (let index = 0; index < 8; index += 1) {
    logs.root.info(`第 ${index} 条足够长的日志，用来触发文件轮转`);
  }

  const path = botLogPath(rootDir);
  expect(existsSync(path)).toBe(true);
  expect(existsSync(`${path}.1`)).toBe(true);
  expect(existsSync(`${path}.2`)).toBe(true);
  expect(existsSync(`${path}.3`)).toBe(false);
  expect(read(path)).toContain("第 7 条");
});
