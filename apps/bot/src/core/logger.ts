import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { dateFormat } from "@nana/utils";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, error?: unknown): void;
  info(message: string, error?: unknown): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
}

export interface LoggerManagerOptions {
  rootDir: string;
  /** 是否同时写控制台；默认 true，方便 `pm2 logs` 实时观察。 */
  console?: boolean;
  /** 单个日志文件的大小上限，默认 10 MiB。 */
  maxBytes?: number;
  /** 每个日志保留的历史文件数，默认 5。 */
  maxFiles?: number;
  /** 时钟注入点，便于测试。 */
  now?: () => Date;
}

export interface LoggerManager {
  /** 进程级日志，例如启动失败、账号跳过、停机。 */
  root: Logger;
  /** 某个 NapCat 账号的独立日志。 */
  account(id: string, name?: string): Logger;
}

export const LOG_DIRECTORY = "logs";
export const ACCOUNT_LOG_DIRECTORY = "accounts";
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;

export function botLogPath(rootDir: string): string {
  return join(rootDir, LOG_DIRECTORY, "bot.log");
}

export function accountLogPath(rootDir: string, accountId: string): string {
  return join(rootDir, LOG_DIRECTORY, ACCOUNT_LOG_DIRECTORY, `${accountId}.log`);
}

/** 只写控制台的兜底日志；运行时会由 {@link createLoggerManager} 替换为文件日志。 */
export const consoleLogger: Logger = {
  debug(message) {
    console.debug(message);
  },
  info(message) {
    console.log(message);
  },
  warn(message, error) {
    if (error === undefined) {
      console.warn(message);
      return;
    }
    console.warn(message, error);
  },
  error(message, error) {
    if (error === undefined) {
      console.error(message);
      return;
    }
    console.error(message, error);
  },
};

export function createLoggerManager(options: LoggerManagerOptions): LoggerManager {
  const shared = {
    console: options.console ?? true,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    now: options.now ?? (() => new Date()),
  };

  return {
    root: createFileLogger(botLogPath(options.rootDir), "NanaBot", shared),
    account(id, name) {
      return createFileLogger(accountLogPath(options.rootDir, id), `NanaBot:${name ?? id}`, shared);
    },
  };
}

function createFileLogger(
  filePath: string,
  scope: string,
  options: {
    console: boolean;
    maxBytes: number;
    maxFiles: number;
    now: () => Date;
  },
): Logger {
  const write = (level: LogLevel, message: string, error?: unknown) => {
    const line = formatLine(level, scope, message, error, options.now());
    if (options.console) {
      writeConsole(level, line);
    }

    try {
      appendWithRotation(filePath, line, options.maxBytes, options.maxFiles);
    } catch (writeError) {
      console.error(`[logger] 写入日志文件失败：${filePath}`, writeError);
    }
  };

  return {
    debug: (message, error) => write("debug", message, error),
    info: (message, error) => write("info", message, error),
    warn: (message, error) => write("warn", message, error),
    error: (message, error) => write("error", message, error),
  };
}

function formatLine(
  level: LogLevel,
  scope: string,
  message: string,
  error: unknown,
  now: Date,
): string {
  const detail = formatError(error);
  const head = `[${dateFormat(now.getTime())}] [${level.toUpperCase()}] [${scope}] ${message}`;
  return detail ? `${head}\n${indent(detail)}` : head;
}

function formatError(error: unknown): string {
  if (error === undefined) {
    return "";
  }
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "[无法序列化的错误对象]";
  }
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function writeConsole(level: LogLevel, line: string): void {
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  if (level === "debug") {
    console.debug(line);
    return;
  }
  console.log(line);
}

function appendWithRotation(
  filePath: string,
  line: string,
  maxBytes: number,
  maxFiles: number,
): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const content = `${line}\n`;
  const incomingBytes = Buffer.byteLength(content);
  const currentBytes = existsSync(filePath) ? statSync(filePath).size : 0;

  if (currentBytes > 0 && currentBytes + incomingBytes > maxBytes) {
    rotate(filePath, maxFiles);
  }
  appendFileSync(filePath, content, "utf8");
}

function rotate(filePath: string, maxFiles: number): void {
  if (maxFiles <= 0) {
    rmSync(filePath, { force: true });
    return;
  }

  rmSync(`${filePath}.${maxFiles}`, { force: true });
  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    const source = `${filePath}.${index}`;
    if (existsSync(source)) {
      renameSync(source, `${filePath}.${index + 1}`);
    }
  }
  renameSync(filePath, `${filePath}.1`);
}
