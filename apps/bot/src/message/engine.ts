import { readAllLiveStatus } from "@nana/storage";
import { writePushLog } from "@nana/storage";
import { PUSH_PURPOSE_LABELS } from "@nana/constants";
import { RE2JS } from "re2js";
import type { FeatureContext, FeatureDefinition } from "../core/feature.ts";
import type { Logger } from "../core/logger.ts";
import { mergeMessageConfig } from "./config.ts";
import type { IncomingMessage, MessageConfig, MessageRule, MessageRuntime } from "./types.ts";
export { normalizeNapcatMessage, normalizeOfficialMessage } from "./platform.ts";

const DEDUP_TTL_MS = 10 * 60_000;
const MAX_DEDUP = 10_000;
const MAX_COOLDOWNS = 10_000;

export interface CommandContext {
  message: IncomingMessage;
  args: string[];
  config: MessageConfig;
  runtime: MessageRuntime;
  reply: (text: string) => Promise<void>;
}

export interface CommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  permission: "everyone" | "admin";
  execute(this: void, context: CommandContext): Promise<void>;
}

export interface CommandRegistry {
  register(command: CommandDefinition): () => void;
  get(name: string): CommandDefinition | undefined;
  list(): CommandDefinition[];
}

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, CommandDefinition>();
  return {
    register(command) {
      const names = [command.name, ...(command.aliases ?? [])].map((name) => name.toLowerCase());
      if (new Set(names).size !== names.length || names.some((name) => commands.has(name)))
        throw new Error(`命令 "${command.name}" 或其别名已注册。`);
      for (const name of names) commands.set(name, command);
      return () => {
        for (const name of names) if (commands.get(name) === command) commands.delete(name);
      };
    },
    get: (name) => commands.get(name.toLowerCase()),
    list: () => [...new Set(commands.values())],
  };
}

export const commandRegistryApi = createCommandRegistry();
export const registerCommand = (command: CommandDefinition) => commandRegistryApi.register(command);
export const getCommand = (name: string) => commandRegistryApi.get(name);
export const listCommands = () => commandRegistryApi.list();

export const builtInCommands: readonly CommandDefinition[] = [
  {
    name: "status",
    aliases: ["状态"],
    description: "查看机器人运行状态",
    permission: "everyone",
    execute: async ({ runtime, reply }) => {
      const statuses = readAllLiveStatus({ rootDir: runtime.rootDir });
      const byRoom = new Map(statuses.map((status) => [status.roomId, status]));
      const known = runtime.roomIds
        .map((roomId) => byRoom.get(String(roomId)))
        .filter((status) => status !== undefined);
      const liveCount = known.filter((status) => status.live).length;
      const liveStatus = runtime.roomIds.length
        ? `${liveCount}${known.length < runtime.roomIds.length ? `（${runtime.roomIds.length - known.length} 个状态未知）` : ""}`
        : "未知";
      await reply(
        [
          "NanaBot：运行中",
          `账号：${runtime.accountName}（${runtime.accountId}，${runtime.connected() ? "已连接" : "未连接"}）`,
          `已连接账号：${runtime.connectedAccounts()}/${runtime.configuredAccounts}`,
          `已配置主播：${runtime.configuredStreamers}`,
          `正在直播：${liveStatus}`,
          `运行时长：${formatDuration(Date.now() - runtime.startedAt)}`,
        ].join("\n"),
      );
    },
  },
  {
    name: "help",
    aliases: ["帮助"],
    description: "查看可用命令",
    permission: "everyone",
    execute: async ({ message, args, config, reply }) => {
      const requested = args[0]?.toLowerCase();
      const visible = listCommands().filter(
        (command) => command.permission === "everyone" || isAdmin(message, config),
      );
      if (requested) {
        const command = getCommand(requested);
        await reply(
          command && visible.includes(command)
            ? `/${command.name} — ${command.description}`
            : `未知命令：${requested}`,
        );
        return;
      }
      await reply(visible.map((command) => `/${command.name} — ${command.description}`).join("\n"));
    },
  },
  {
    name: "live",
    aliases: ["直播"],
    description: "查询直播状态",
    permission: "everyone",
    execute: async ({ args, runtime, reply }) => {
      if (args.length > 1 || (args[0] && !/^\d+$/.test(args[0]))) {
        await reply("用法：/live [房间号]");
        return;
      }
      const statuses = readAllLiveStatus({ rootDir: runtime.rootDir });
      const byRoom = new Map(statuses.map((status) => [status.roomId, status]));
      if (args[0] && !runtime.roomIds.includes(Number(args[0]))) {
        await reply(`该账号未配置直播间 ${args[0]}。`);
        return;
      }
      if (!runtime.roomIds.length) {
        await reply("该账号没有配置主播。");
        return;
      }
      await reply(
        (args[0] ? [args[0]] : runtime.roomIds.map(String))
          .map((roomId) => {
            const status = byRoom.get(roomId);
            if (!status) return `直播间 ${roomId}：状态未知`;
            return `${status.streamer}（${status.roomId}）：${status.live ? "直播中" : "未开播"}${status.title ? `「${status.title}」` : ""}`;
          })
          .join("\n"),
      );
    },
  },
];
builtInCommands.forEach(registerCommand);

export interface MessageFeatureOptions {
  config: unknown;
  accountConfig?: unknown;
  runtime: MessageRuntime;
  logger: Logger;
  now?: () => number;
}

export function createMessageFeature(): FeatureDefinition<MessageFeatureOptions> {
  return {
    name: "message",
    setup(context, options) {
      let config: MessageConfig;
      try {
        config = mergeMessageConfig(options.config, options.accountConfig);
      } catch (error) {
        options.logger.error("[message] 消息配置无效，消息功能已禁用", error);
        return;
      }
      if (!config.enabled) return;
      const dedup = new Map<string, number>();
      const cooldowns = new Map<string, number>();
      return context.onMessage((message) =>
        handleMessage(
          context,
          message,
          config,
          options.runtime,
          options.logger,
          dedup,
          cooldowns,
          options.now ?? (() => performance.now()),
        ),
      );
    },
  };
}

export function matchMessageRules(
  text: string,
  rules: readonly MessageRule[],
  stopOnFirstMatch = true,
): string | undefined {
  const matched = rules.filter((rule) => rule.enabled && matchesRule(text, rule));
  const selected = stopOnFirstMatch ? matched.slice(0, 1) : matched;
  if (!selected.length) return undefined;
  return selected
    .map((rule) => {
      const choices = Array.isArray(rule.response) ? rule.response : [rule.response];
      return choices[Math.floor(Math.random() * choices.length)]!;
    })
    .join("\n");
}

export function parseCommand(
  text: string,
  prefix = "/",
): { name: string; args: string[] } | undefined {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(prefix)) return undefined;
  const tokens = trimmed.slice(prefix.length).trim().split(/\s+/).filter(Boolean);
  const name = tokens.shift();
  return name ? { name: name.toLowerCase(), args: tokens } : undefined;
}

async function handleMessage(
  context: FeatureContext,
  message: IncomingMessage,
  config: MessageConfig,
  runtime: MessageRuntime,
  logger: Logger,
  dedup: Map<string, number>,
  cooldowns: Map<string, number>,
  now: () => number,
) {
  try {
    if (!message.text.trim() || !message.id || !message.conversationId) return;
    const currentTime = now();
    cleanupMap(dedup, currentTime);
    const key = `${message.accountId}:${message.platform}:${message.id}`;
    logger.debug?.(
      `[message] incoming account=${message.accountId} platform=${message.platform} scene=${message.scene} message=${message.id}`,
    );
    if (dedup.has(key)) {
      logger.debug?.(`[message] duplicate key=${key}`);
      return;
    }
    dedup.set(key, currentTime);
    const scope = config.scopes[message.scene];
    if (
      !scope.enabled ||
      scope.deny.includes(message.conversationId) ||
      (scope.allow.length > 0 && !scope.allow.includes(message.conversationId))
    ) {
      logger.debug?.(`[message] scope blocked key=${key}`);
      return;
    }

    const trimmedText = message.text.trimStart();
    const hasCommandPrefix = trimmedText.startsWith(config.commands.prefix);
    if (hasCommandPrefix && !config.commands.enabled) return;
    const parsed = parseCommand(trimmedText, config.commands.prefix);
    if (parsed) {
      const command = getCommand(config.commands.aliases[parsed.name] ?? parsed.name);
      if (!command) {
        await sendResponse(
          context,
          runtime,
          logger,
          message,
          `未知命令：${parsed.name}`,
          "message.command",
        );
        return;
      }
      if (command.permission === "admin" && !isAdmin(message, config)) {
        logger.debug?.(`[message] permission denied command=${command.name} key=${key}`);
        await sendResponse(
          context,
          runtime,
          logger,
          message,
          "你没有权限执行此命令。",
          "message.command",
        );
        return;
      }
      if (
        !takeCooldown(
          cooldowns,
          `${message.accountId}:command:${message.senderId}`,
          config.cooldown.commandUserMs,
          config.cooldown.enabled,
          currentTime,
        )
      ) {
        logger.debug?.(`[message] command cooldown command=${command.name} key=${key}`);
        return;
      }
      logger.info(
        `[message] command account=${message.accountId} platform=${message.platform} scene=${message.scene} message=${message.id} command=${command.name}`,
      );
      await command.execute({
        message,
        args: parsed.args,
        runtime,
        config,
        reply: async (text) =>
          sendResponse(context, runtime, logger, message, text, "message.command"),
      });
      return;
    }
    if (!config.rules.enabled) return;
    const response = matchMessageRules(
      message.text,
      config.rules.items,
      config.rules.stopOnFirstMatch,
    );
    if (!response) return;
    const matchedRule = config.rules.items.find(
      (rule) => rule.enabled && matchesRule(message.text, rule),
    );
    if (
      !takeCooldown(
        cooldowns,
        `${message.accountId}:rule:${message.senderId}`,
        config.cooldown.ruleUserMs,
        config.cooldown.enabled,
        currentTime,
      )
    ) {
      logger.debug?.(`[message] rule user cooldown key=${key}`);
      return;
    }
    if (
      !takeCooldown(
        cooldowns,
        `${message.accountId}:rule:${message.conversationId}`,
        config.cooldown.ruleConversationMs,
        config.cooldown.enabled,
        currentTime,
      )
    ) {
      logger.debug?.(`[message] rule conversation cooldown key=${key}`);
      return;
    }
    logger.info(
      `[message] rule account=${message.accountId} platform=${message.platform} scene=${message.scene} message=${message.id} rule=${matchedRule?.id ?? "unknown"}`,
    );
    await sendResponse(context, runtime, logger, message, response, "message.auto-reply");
  } catch (error) {
    logger.error(
      `[message] 处理消息失败 account=${message.accountId} message=${message.id}`,
      error,
    );
  }
}

export function matchesRule(text: string, rule: MessageRule) {
  const source = rule.ignoreCase === false ? text : text.toLowerCase();
  const pattern = rule.ignoreCase === false ? rule.pattern : rule.pattern.toLowerCase();
  switch (rule.type) {
    case "exact":
      return source === pattern;
    case "contains":
      return source.includes(pattern);
    case "startsWith":
      return source.startsWith(pattern);
    case "regex":
      try {
        return RE2JS.compile(rule.pattern, rule.ignoreCase === false ? 0 : RE2JS.CASE_INSENSITIVE)
          .matcher(text)
          .find();
      } catch {
        return false;
      }
  }
}

function isAdmin(message: IncomingMessage, config: MessageConfig) {
  return (
    config.admins.users.includes(message.senderId) ||
    (message.scene === "group" && config.admins.groups.includes(message.conversationId))
  );
}

async function sendResponse(
  context: FeatureContext,
  runtime: MessageRuntime,
  logger: Logger,
  message: IncomingMessage,
  response: string,
  purpose: "message.command" | "message.auto-reply",
) {
  const text = response.slice(0, 2_000);
  try {
    await context.replyMessage(message, { text });
    record(true);
    logger.info(
      `[message] reply account=${message.accountId} platform=${message.platform} scene=${message.scene} message=${message.id} target=${message.conversationId} purpose=${purpose} result=success`,
    );
  } catch (error) {
    record(false, error instanceof Error ? error.message : String(error));
    logger.error(
      `[message] reply account=${message.accountId} platform=${message.platform} scene=${message.scene} message=${message.id} target=${message.conversationId} purpose=${purpose} result=failure`,
      error,
    );
    throw error;
  }
  function record(success: boolean, error?: string) {
    try {
      writePushLog(
        {
          account: runtime.accountId,
          targetId: message.conversationId,
          target:
            message.scene === "group" ? `群${message.conversationId}` : `用户${message.senderId}`,
          purpose,
          purposeLabel: PUSH_PURPOSE_LABELS[purpose],
          pushedAt: new Date().toISOString(),
          success,
          error: error ?? null,
          content: text.slice(0, 300),
          subject: "NanaBot",
        },
        { rootDir: runtime.rootDir },
      );
    } catch (cause) {
      logger.error("[message] 写入回复日志失败", cause);
    }
  }
}

function cleanupMap(map: Map<string, number>, now: number) {
  for (const [key, time] of map) if (now - time > DEDUP_TTL_MS) map.delete(key);
  while (map.size > MAX_DEDUP) map.delete(map.keys().next().value ?? "");
}

function takeCooldown(
  cooldowns: Map<string, number>,
  key: string,
  duration: number,
  enabled: boolean,
  now: number,
) {
  if (!enabled || duration === 0) return true;
  const previous = cooldowns.get(key);
  if (previous !== undefined && now - previous < duration) return false;
  cooldowns.set(key, now);
  while (cooldowns.size > MAX_COOLDOWNS) cooldowns.delete(cooldowns.keys().next().value ?? "");
  return true;
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 3600)}小时${Math.floor((seconds % 3600) / 60)}分钟`;
}
