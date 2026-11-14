import { QQClient, type QQClientPort } from "@nana/qq";
import {
  prepareQQGroupDiscovery,
  recordDiscoveredQQGroup,
  type StorageOptions,
} from "@nana/storage";
import { loadOfficialGroups } from "@nana/config";
import type { BotApp } from "../core/app";
import { createCleanupManager } from "../core/event";
import type { FeatureContext } from "../core/feature";
import { consoleLogger, type Logger } from "../core/logger";
import { CONNECT_TIMEOUT_MS } from "../core/connection";
import type { OfficialAccount } from "./config";
import { OfficialPushClient } from "./push";
import type { IncomingMessage, MessageReply, PlatformConnectionState } from "../message/types.ts";
import { OfficialMessageAdapter } from "../message/platform.ts";
import { textPart } from "../message/parts.ts";

export interface OfficialAppOptions {
  account: OfficialAccount;
  storage?: StorageOptions;
  logger?: Logger;
  /** 测试注入；生产使用腾讯官方 SDK。 */
  client?: QQClientPort;
  /** 测试注入：被动回复窗口的时钟。 */
  now?: () => number;
  connectTimeoutMs?: number;
}

export function createOfficialApp(options: OfficialAppOptions): BotApp {
  const { account } = options;
  const logger = options.logger ?? consoleLogger;
  const client =
    options.client ??
    new QQClient({
      appId: account.appId,
      appSecret: account.appSecret,
      accountId: account.id,
      logger,
      sandbox: account.sandbox,
    });
  const adapter = new OfficialMessageAdapter(client, account.id, {
    ...(options.now ? { now: options.now } : {}),
    logger,
  });
  const push = new OfficialPushClient(client, account, options.storage, logger, () =>
    loadOfficialGroups(account.id, options.storage?.rootDir),
  );
  const cleanups = createCleanupManager();
  const pluginTasks: Promise<void>[] = [];
  const connectedHandlers = new Set<() => void>();
  const stateHandlers = new Set<(state: PlatformConnectionState) => void>();
  const discovered = new Map<string, number>();
  let state: "idle" | "starting" | "started" | "stopping" | "stopped" = "idle";
  let runTask: Promise<void> | undefined;
  let stopTask: Promise<void> | undefined;
  let disconnectedAt: number | undefined;
  let connectedState = false;
  let resolveReady: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const notifyState = (state: PlatformConnectionState) => {
    connectedState = state.connected;
    for (const handler of stateHandlers) handler(state);
  };
  const onReady = () => {
    if (state === "stopping" || state === "stopped") return;
    if (disconnectedAt !== undefined) {
      logger.info(
        `[官方 QQ] 连接已恢复（中断 ${((Date.now() - disconnectedAt) / 1000).toFixed(1)} 秒）`,
      );
      disconnectedAt = undefined;
    }
    resolveReady();
    notifyState({ connected: true, phase: "connected", platform: "official" });
    for (const handler of connectedHandlers) handler();
  };
  cleanups.add(client.on("connected", onReady));
  cleanups.add(
    client.on("disconnected", (event) => {
      if (state === "stopping" || state === "stopped") return;
      disconnectedAt ??= Date.now();
      logger.warn(
        `[官方 QQ] 连接断开（${event.code}），${event.willReconnect ? "等待自动重连" : "无法重连"}；原因：${event.reason || "未提供"}`,
      );
      notifyState({ connected: false, phase: "disconnected", platform: "official" });
    }),
  );
  cleanups.add(client.on("error", (error) => logger.error("[官方 QQ] 通信错误", error)));
  cleanups.add(
    client.on("groupDiscovered", (group) => {
      const last = discovered.get(group.openid);
      if (last && Date.now() - last < 60_000) return;
      try {
        recordDiscoveredQQGroup(
          {
            accountId: account.id,
            appId: account.appId,
            openid: group.openid,
            lastSeenAt: new Date().toISOString(),
          },
          options.storage,
        );
        discovered.set(group.openid, Date.now());
        if (!last)
          logger.info(`[官方 QQ] 发现 group_openid=${group.openid}；可在 site 设置中绑定对应群。`);
      } catch (error) {
        logger.error("[官方 QQ] 保存已发现的群标识失败", error);
      }
    }),
  );

  const context: FeatureContext = {
    accountId: account.id,
    adminGroupId: account.adminGroupId,
    logger,
    onCleanup: (cleanup) => cleanups.add(cleanup),
    onMessage(handler) {
      const unsubscribe = adapter.onMessage(handler);
      cleanups.add(unsubscribe);
      return unsubscribe;
    },
    replyMessage: (message, response) => adapter.reply(message, response),
    onConnectionState(handler) {
      stateHandlers.add(handler);
      const unsubscribe = () => stateHandlers.delete(handler);
      cleanups.add(() => {
        unsubscribe();
      });
      return unsubscribe;
    },
    async sendAdminText(text, purpose = { purpose: "notification" }) {
      if (!account.adminGroupId) return;
      await push.sendGroupMsg(
        account.adminGroupId,
        { ...purpose, content: text, subject: "NanaBot" },
        [textPart(text)],
      );
    },
    async sendAdminMsg(messages, purpose = { purpose: "notification" }) {
      if (!account.adminGroupId) return;
      await push.sendGroupMsg(account.adminGroupId, { ...purpose, subject: "NanaBot" }, messages);
    },
    sendGroupMsg: (id, purpose, messages) => push.sendGroupMsg(id, purpose, messages),
    sendMessage: (target, message) => adapter.send(target, message),
  };

  const app: BotApp = {
    ...context,
    onMessage(handler) {
      return context.onMessage(handler);
    },
    replyMessage(message: IncomingMessage, response: MessageReply) {
      return context.replyMessage(message, response);
    },
    async sendTyping(target, durationSec) {
      if (!adapter.sendTyping) throw new Error("当前平台不支持输入中状态。");
      await adapter.sendTyping(target, durationSec);
    },
    get connected() {
      return connectedState;
    },
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
      const unsubscribe = () => connectedHandlers.delete(handler);
      cleanups.add(() => {
        unsubscribe();
      });
      return unsubscribe;
    },
    async start() {
      if (state === "started") return;
      if (state !== "idle") throw new Error(`当前状态为 "${state}"，无法启动应用。`);
      state = "starting";
      await Promise.all(pluginTasks);
      if (state !== "starting") return;
      try {
        prepareQQGroupDiscovery(account.id, account.appId, options.storage);
      } catch (error) {
        logger.error("[官方 QQ] 初始化群标识发现存储失败", error);
      }
      notifyState({ connected: false, phase: "connecting", platform: "official" });
      runTask = adapter.start();
      // SDK start() 在整个连接生命周期内保持 pending，不能直接 await。
      void runTask.catch((error) => {
        if (state === "stopping" || state === "stopped") return;
        logger.error("[官方 QQ] 连接终止，需要检查凭据或平台权限", error);
        notifyState({ connected: false, phase: "disconnected", platform: "official" });
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
          await adapter.stop();
          connectedHandlers.clear();
          stateHandlers.clear();
          await runTask?.catch(() => undefined);
          state = "stopped";
        }
      })();
      return stopTask;
    },
  };
  return app;
}
