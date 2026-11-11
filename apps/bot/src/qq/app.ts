import { QQBot } from "@tencent-connect/qqbot-nodejs";
import { Structs } from "node-napcat-ts";
import type { StorageOptions } from "@nana/storage";
import type { BotApp } from "../core/app";
import { createCleanupManager } from "../core/event";
import type { FeatureContext } from "../core/feature";
import { consoleLogger, type Logger } from "../core/logger";
import { CONNECT_TIMEOUT_MS } from "../core/connection";
import type { OfficialAccount } from "./config";
import { OfficialPushClient } from "./push";

export interface OfficialAppOptions {
  account: OfficialAccount;
  storage?: StorageOptions;
  logger?: Logger;
  /** 测试注入；生产使用腾讯官方 SDK。 */
  bot?: QQBot;
  connectTimeoutMs?: number;
}

export function createOfficialApp(options: OfficialAppOptions): BotApp {
  const { account } = options;
  const logger = options.logger ?? consoleLogger;
  const bot =
    options.bot ??
    new QQBot({
      appId: account.appId,
      appSecret: account.appSecret,
      accountId: account.id,
      logger,
      // 仅订阅 QQ 群与单聊，避免申请无关的频道权限。
      intents: 1 << 25,
      markdownSupport: false,
      ...(account.sandbox ? { baseUrl: "https://sandbox.api.sgroup.qq.com" } : {}),
    });
  const push = new OfficialPushClient(bot, account, options.storage, logger);
  const cleanups = createCleanupManager();
  const pluginTasks: Promise<void>[] = [];
  const connectedHandlers = new Set<() => void>();
  const stateHandlers = new Set<(connected: boolean) => void>();
  let state: "idle" | "starting" | "started" | "stopping" | "stopped" = "idle";
  let runTask: Promise<void> | undefined;
  let stopTask: Promise<void> | undefined;
  let resolveReady: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const notifyState = (connected: boolean) => {
    for (const handler of stateHandlers) handler(connected);
  };
  const onReady = () => {
    if (state === "stopping" || state === "stopped") return;
    resolveReady();
    notifyState(true);
    for (const handler of connectedHandlers) handler();
  };
  bot.on("ready", onReady);
  bot.on("resumed", onReady);
  bot.on("disconnected", (event) => {
    if (state === "stopping" || state === "stopped") return;
    logger.warn(
      `[官方 QQ] 连接断开（${event.code}），${event.willReconnect ? "等待自动重连" : "无法重连"}`,
    );
    notifyState(false);
  });
  bot.on("error", (error) => logger.error("[官方 QQ] SDK 错误", error));
  // 只记录路由发现信息，不回复普通聊天，也不记录群聊内容。
  const discovered = new Set<string>();
  const discoverGroup = (openid: string) => {
    if (discovered.has(openid)) return;
    discovered.add(openid);
    logger.info(
      `[官方 QQ] 发现 group_openid=${openid}；请将其填入当前账号的 groups.<群别名>.openid。`,
    );
  };
  bot.on("message", (_ctx, message) => {
    if (message.kind === "group" && message.groupOpenid) discoverGroup(message.groupOpenid);
  });
  bot.on("rawEvent", (event) => {
    if (event.eventType !== "GROUP_ADD_ROBOT") return;
    const data = event.data as { group_openid?: unknown };
    if (typeof data?.group_openid === "string") discoverGroup(data.group_openid);
  });

  const context: FeatureContext = {
    accountId: account.id,
    adminGroupId: account.adminGroupId,
    logger,
    onCleanup: (cleanup) => cleanups.add(cleanup),
    onConnectionState(handler) {
      stateHandlers.add(handler);
      const unsubscribe = () => {
        stateHandlers.delete(handler);
      };
      cleanups.add(unsubscribe);
      return unsubscribe;
    },
    async sendAdminText(text, purpose = { purpose: "notification" }) {
      if (!account.adminGroupId) return;
      await push.sendGroupMsg(
        account.adminGroupId,
        { ...purpose, content: text, subject: "NanaBot" },
        [Structs.text(text)],
      );
    },
    async sendAdminMsg(messages, purpose = { purpose: "notification" }) {
      if (!account.adminGroupId) return;
      await push.sendGroupMsg(account.adminGroupId, { ...purpose, subject: "NanaBot" }, messages);
    },
    sendGroupMsg: (id, purpose, messages) => push.sendGroupMsg(id, purpose, messages),
  };

  const app: BotApp = {
    ...context,
    use(feature, featureOptions) {
      if (state !== "idle") throw new Error("必须在 app.start() 之前注册功能。");
      pluginTasks.push(
        Promise.resolve(feature.setup(context, featureOptions)).then((cleanup) =>
          cleanups.add(cleanup),
        ),
      );
      return app;
    },
    onConnected(handler) {
      connectedHandlers.add(handler);
      const unsubscribe = () => {
        connectedHandlers.delete(handler);
      };
      cleanups.add(unsubscribe);
      return unsubscribe;
    },
    async start() {
      if (state === "started") return;
      if (state !== "idle") throw new Error(`当前状态为 "${state}"，无法启动应用。`);
      state = "starting";
      await Promise.all(pluginTasks);
      if (state !== "starting") return;
      notifyState(false);
      runTask = bot.start();
      // SDK start() 在整个连接生命周期内保持 pending，不能直接 await。
      void runTask.catch((error) => {
        if (state === "stopping" || state === "stopped") return;
        logger.error("[官方 QQ] 连接终止，需要检查凭据或平台权限", error);
        notifyState(false);
        if (state === "started")
          void app.stop().catch((stopError) => logger.error("[官方 QQ] 清理失败", stopError));
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const connected = await Promise.race([
          ready.then(() => true),
          runTask.then(() => {
            throw new Error("官方 QQ 连接在就绪前已结束。");
          }),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(
              () => resolve(false),
              options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
            );
          }),
        ]);
        if (state === "starting") state = "started";
        logger.info(
          connected ? "[官方 QQ] 启动完成" : "[官方 QQ] 首次连接尚未完成，SDK 将持续重试",
        );
      } finally {
        clearTimeout(timer);
      }
    },
    stop(stopOptions) {
      if (stopTask) return stopTask;
      state = "stopping";
      stopTask = (async () => {
        try {
          if (stopOptions?.announce)
            await context.sendAdminText(stopOptions.announce, { purpose: "app.offline" });
        } catch (error) {
          logger.error("[官方 QQ] 发送下线通知失败", error);
        }
        try {
          await Promise.allSettled(pluginTasks);
          await cleanups.run();
        } finally {
          bot.stop();
          await runTask?.catch(() => undefined);
          connectedHandlers.clear();
          stateHandlers.clear();
          state = "stopped";
        }
      })();
      return stopTask;
    },
  };
  return app;
}
