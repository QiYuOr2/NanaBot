import { NapcatClient, type NapcatClientPort } from "@nana/napcat";
import { readOptionalNumberEnv } from "@nana/utils";
import { ENV_KEYS } from "@nana/constants";
import type { StorageOptions } from "@nana/storage";
import { createCleanupManager, type Cleanup } from "./event";
import type { FeatureContext, FeatureDefinition } from "./feature";
import { NapcatPushClient, type GroupPushOptions, type PushPurposeInput } from "./napcat";
import {
  CONNECT_TIMEOUT_MS,
  ConnectionSupervisor,
  settleWithin,
  type ConnectionSupervisorOptions,
} from "./connection";
import { consoleLogger, type Logger } from "./logger";
import type { IncomingMessage, MessageTarget, OutgoingMessage } from "../message/types.ts";
import { NapcatMessageAdapter } from "../message/platform.ts";
import { textPart } from "../message/parts.ts";
import type { PlatformConnectionState } from "../message/types.ts";

export interface CreateAppOptions {
  websocket: { baseUrl: string; accessToken?: string };
  account?: { id: string; name?: string };
  adminGroupId?: number;
  storage?: StorageOptions;
  connection?: ConnectionSupervisorOptions;
  logger?: Logger;
  handleSignals?: boolean;
  client?: NapcatClientPort;
}

export interface StopOptions {
  announce?: string;
}

export interface App {
  accountId: string;
  adminGroupId?: number;
  readonly connected: boolean;
  use<TOptions>(feature: FeatureDefinition<TOptions>, options: TOptions): App;
  onConnected(handler: () => void): () => void;
  onConnectionState(handler: (state: PlatformConnectionState) => void): () => void;
  onMessage(handler: (message: IncomingMessage) => void | Promise<void>): () => void;
  replyMessage(message: IncomingMessage, response: OutgoingMessage): Promise<void>;
  sendMessage(target: MessageTarget, message: OutgoingMessage): Promise<void>;
  sendTyping(target: MessageTarget, durationSec: number): Promise<void>;
  onCleanup(cleanup: Cleanup): void;
  sendAdminText(text: string, purpose?: PushPurposeInput): Promise<void>;
  sendAdminMsg(
    messages: Parameters<FeatureContext["sendAdminMsg"]>[0],
    purpose?: PushPurposeInput,
  ): Promise<void>;
  sendGroupMsg(
    groupId: number,
    options: GroupPushOptions,
    messages: Parameters<FeatureContext["sendGroupMsg"]>[2],
  ): Promise<string>;
  start(): Promise<void>;
  stop(options?: StopOptions): Promise<void>;
}

export function createApp(options: CreateAppOptions): App {
  const logger = options.logger ?? consoleLogger;
  const accountId = options.account?.id ?? "default";
  const client =
    options.client ??
    new NapcatClient({
      url: options.websocket.baseUrl,
      accessToken: options.websocket.accessToken,
      accountId,
      logger,
      debug: readOptionalNumberEnv(ENV_KEYS.NC_DEBUG) === 1,
      reconnect: options.connection?.enabled,
    });
  const pushClient = new NapcatPushClient(client, {
    ...options.storage,
    account: accountId,
    logger,
  });
  const connection = new ConnectionSupervisor(client, {
    ...options.connection,
    logger: options.connection?.logger ?? logger,
  });
  const cleanupManager = createCleanupManager();
  const pluginTasks: Promise<void>[] = [];
  const adapter = new NapcatMessageAdapter(client, accountId);
  const stateHandlers = new Set<(state: PlatformConnectionState) => void>();
  const connectedHandlers = new Set<() => void>();
  let state: "idle" | "starting" | "started" | "stopping" | "stopped" = "idle";
  let stopTask: Promise<void> | undefined;

  cleanupManager.add(
    adapter.onConnectionState((state) => {
      for (const handler of stateHandlers) handler(state);
      if (state.connected) for (const handler of connectedHandlers) handler();
    }),
  );

  const featureContext: FeatureContext = {
    accountId,
    adminGroupId: options.adminGroupId,
    logger,
    onCleanup: (cleanup) => cleanupManager.add(cleanup),
    onMessage: (handler) => {
      const unsubscribe = adapter.onMessage(handler);
      cleanupManager.add(() => {
        unsubscribe();
      });
      return unsubscribe;
    },
    replyMessage: async (message, response) => {
      await adapter.reply(message, response);
    },
    sendMessage: async (target, message) => {
      await adapter.send(target, message);
    },
    onHeartbeat: (handler) => {
      const unsubscribe = adapter.onHeartbeat(handler);
      cleanupManager.add(unsubscribe);
      return unsubscribe;
    },
    onConnectionState(handler) {
      stateHandlers.add(handler);
      const unsubscribe = () => stateHandlers.delete(handler);
      cleanupManager.add(() => {
        unsubscribe();
      });
      return unsubscribe;
    },
    async sendAdminText(text, purpose = { purpose: "notification" }) {
      if (!options.adminGroupId) return;
      await pushClient.sendGroupMsg(
        options.adminGroupId,
        { ...purpose, content: text, subject: "NanaBot" },
        [textPart(text)],
      );
    },
    async sendAdminMsg(messages, purpose = { purpose: "notification" }) {
      if (!options.adminGroupId) return;
      await pushClient.sendGroupMsg(
        options.adminGroupId,
        { ...purpose, subject: "NanaBot" },
        messages,
      );
    },
    sendGroupMsg: (groupId, groupOptions, messages) =>
      pushClient.sendGroupMsg(groupId, groupOptions, messages),
  };

  const app: App = {
    ...featureContext,
    async sendTyping(target, durationSec) {
      if (!adapter.sendTyping) throw new Error("当前平台不支持输入中状态。");
      await adapter.sendTyping(target, durationSec);
    },
    get connected() {
      return connection.isConnected;
    },
    use(feature, featureOptions) {
      if (state !== "idle") throw new Error("必须在 app.start() 之前注册功能。");
      pluginTasks.push(
        Promise.resolve(feature.setup(featureContext, featureOptions)).then((cleanup) =>
          cleanupManager.add(cleanup),
        ),
      );
      return app;
    },
    onConnected(handler) {
      connectedHandlers.add(handler);
      const unsubscribe = () => connectedHandlers.delete(handler);
      cleanupManager.add(() => {
        unsubscribe();
      });
      return unsubscribe;
    },
    async start() {
      if (state === "started") return;
      if (state !== "idle") throw new Error(`当前状态为 "${state}"，无法启动应用。`);
      state = "starting";
      await Promise.all(pluginTasks);
      connection.start();
      if (!(await settleWithin(adapter.start(), CONNECT_TIMEOUT_MS))) {
        if (options.connection?.enabled === false)
          throw new Error("首次连接 NapCat 失败；看门狗已关闭，不再重试。");
        logger.warn(
          `首次连接 NapCat 超过 ${CONNECT_TIMEOUT_MS}ms 未成功，改由连接看门狗持续重试。`,
        );
      }
      state = "started";
      logger.info(`启动完成；连接状态：${connection.isConnected ? "已连接" : "等待重连"}`);
    },
    stop(stopOptions) {
      if (state === "stopped") return Promise.resolve();
      if (stopTask) return stopTask;
      stopTask = (async () => {
        state = "stopping";
        connection.stop();
        if (stopOptions?.announce)
          await safely(
            () => app.sendAdminText(stopOptions.announce!, { purpose: "app.offline" }),
            logger,
          );
        await safely(() => cleanupManager.run(), logger);
        await safely(() => adapter.stop(), logger);
        state = "stopped";
      })();
      return stopTask;
    },
  };
  return app;
}

async function safely(task: () => Promise<void>, logger: Logger) {
  try {
    await task();
  } catch (error) {
    logger.error("执行清理任务时发生错误", error);
  }
}
