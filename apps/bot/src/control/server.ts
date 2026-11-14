import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  BOT_CONTROL_BRIDGE_BIND_PATH,
  BOT_CONTROL_BRIDGE_MESSAGES_PATH,
  BOT_CONTROL_BRIDGE_SEND_PATH,
  BOT_CONTROL_BRIDGE_STATUS_PATH,
  BOT_CONTROL_DEFAULT_PORT,
  BOT_CONTROL_HEALTH_PATH,
  BOT_CONTROL_TEST_MESSAGE_PATH,
  ENV_KEYS,
} from "@nana/constants";
import { readProjectAuthToken } from "@nana/utils";
import type { Logger } from "../core/logger.ts";
import {
  bindBridgeOwner,
  getBridgeMessages,
  getBridgeStatus,
  sendBridgeMessage,
  type BridgeDeps,
  type BridgeRuntime,
} from "./bridge.ts";
import { BotControlError, sendTestMessage, type TestMessageRuntime } from "./testMessage.ts";

const MAX_BODY_BYTES = 16 * 1024;

export interface BotControlServerOptions {
  runtimes: ReadonlyMap<string, TestMessageRuntime>;
  /** 已启用桥接的账号运行时；未传或为空时桥接接口一律返回 503。 */
  bridges?: ReadonlyMap<string, BridgeRuntime>;
  rootDir: string;
  logger: Logger;
  port?: number;
}

export interface BotControlServer {
  url: string;
  stop(): Promise<void>;
}

function readControlToken(rootDir: string): string | undefined {
  const token = readProjectAuthToken(rootDir);
  return token && token.length >= 16 ? token : undefined;
}

/** 桥接专用口令：只从 bot 进程环境读取（apps/bot/.env 由入口 dotenv 载入）。 */
function readBridgeToken(): string | undefined {
  const token = process.env[ENV_KEYS.NANA_BRIDGE_TOKEN]?.trim();
  return token && token.length >= 16 ? token : undefined;
}

function readBearer(request: IncomingMessage): string {
  const authorization = request.headers.authorization ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function tokensEqual(expected: string, provided: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(expected), digest(provided));
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new BotControlError(413, "请求体过大。");
    chunks.push(buffer);
  }
  if (!chunks.length) throw new BotControlError(400, "请求体不能为空。");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new BotControlError(400, "请求体必须是合法 JSON。");
  }
}

const BRIDGE_PATHS = new Set([
  BOT_CONTROL_BRIDGE_STATUS_PATH,
  BOT_CONTROL_BRIDGE_MESSAGES_PATH,
  BOT_CONTROL_BRIDGE_SEND_PATH,
  BOT_CONTROL_BRIDGE_BIND_PATH,
]);

async function handleBridgeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: BotControlServerOptions,
  url: URL,
): Promise<void> {
  const bridges = options.bridges;
  if (!bridges || bridges.size === 0) {
    sendJson(response, 503, { ok: false, error: "桥接未启用。" });
    return;
  }
  const deps: BridgeDeps = { bridges, logger: options.logger };
  const path = url.pathname;
  try {
    // 状态探针不设口令：只返回是否绑定与最近入站 seq，供无秘密的轮询方判断有无新消息。
    if (request.method === "GET" && path === BOT_CONTROL_BRIDGE_STATUS_PATH) {
      const accountId = url.searchParams.get("account");
      if (!accountId) throw new BotControlError(400, "缺少 account 参数。");
      const status = await getBridgeStatus(deps, accountId, {
        since: url.searchParams.get("since") ?? undefined,
        wait: url.searchParams.get("wait") ?? undefined,
      });
      sendJson(response, 200, { ok: true, ...status });
      return;
    }

    // 其余桥接接口只认桥接专用口令或全站管理口令，且仅本机可达（site 中转或本机直连）。
    const bridgeToken = readBridgeToken();
    const controlToken = readControlToken(options.rootDir);
    if (!bridgeToken && !controlToken) {
      sendJson(response, 503, {
        ok: false,
        error: "桥接接口未配置口令，请设置 NANA_BRIDGE_TOKEN 或 NANA_AUTH_TOKEN。",
      });
      return;
    }
    const provided = readBearer(request);
    const authorized =
      provided.length > 0 &&
      ((bridgeToken !== undefined && tokensEqual(bridgeToken, provided)) ||
        (controlToken !== undefined && tokensEqual(controlToken, provided)));
    if (!authorized) {
      sendJson(response, 401, { ok: false, error: "桥接口令不正确。" });
      return;
    }

    if (request.method === "GET" && path === BOT_CONTROL_BRIDGE_MESSAGES_PATH) {
      const accountId = url.searchParams.get("account");
      if (!accountId) throw new BotControlError(400, "缺少 account 参数。");
      const result = getBridgeMessages(deps, accountId, url.searchParams.get("after") ?? 0);
      sendJson(response, 200, { ok: true, ...result });
      return;
    }
    if (request.method === "POST" && path === BOT_CONTROL_BRIDGE_SEND_PATH) {
      const result = await sendBridgeMessage(deps, await readJson(request));
      sendJson(response, 200, { ok: true, ...result });
      return;
    }
    if (request.method === "POST" && path === BOT_CONTROL_BRIDGE_BIND_PATH) {
      const result = bindBridgeOwner(deps, await readJson(request));
      sendJson(response, 200, { ok: true, ...result });
      return;
    }
    sendJson(response, 404, { ok: false, error: "接口不存在。" });
  } catch (error) {
    if (error instanceof BotControlError) {
      sendJson(response, error.statusCode, { ok: false, error: error.message });
      return;
    }
    options.logger.error("[control] 处理桥接请求失败", error);
    sendJson(response, 500, { ok: false, error: "bot 处理桥接请求时发生内部错误。" });
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: BotControlServerOptions,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  // 健康检查只证明进程存活，不需要口令，也不返回任何运行细节。
  if (request.method === "GET" && url.pathname === BOT_CONTROL_HEALTH_PATH) {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (BRIDGE_PATHS.has(url.pathname)) {
    await handleBridgeRequest(request, response, options, url);
    return;
  }

  if (request.method !== "POST" || url.pathname !== BOT_CONTROL_TEST_MESSAGE_PATH) {
    sendJson(response, 404, { ok: false, error: "接口不存在。" });
    return;
  }

  const expected = readControlToken(options.rootDir);
  if (!expected) {
    sendJson(response, 503, {
      ok: false,
      error: "bot 控制接口未配置管理口令，请设置根目录 .env 的 NANA_AUTH_TOKEN。",
    });
    return;
  }
  const provided = readBearer(request);
  if (!provided || !tokensEqual(expected, provided)) {
    sendJson(response, 401, { ok: false, error: "管理口令不正确。" });
    return;
  }

  try {
    const body = await readJson(request);
    const result = await sendTestMessage(body, {
      runtimes: options.runtimes,
      rootDir: options.rootDir,
      logger: options.logger,
    });
    sendJson(response, 200, { ok: true, target: result.target });
  } catch (error) {
    if (error instanceof BotControlError) {
      sendJson(response, error.statusCode, { ok: false, error: error.message });
      return;
    }
    options.logger.error("[control] 处理测试消息请求失败", error);
    sendJson(response, 500, { ok: false, error: "bot 处理测试消息时发生内部错误。" });
  }
}

export async function startBotControlServer(
  options: BotControlServerOptions,
): Promise<BotControlServer> {
  const server: Server = createServer((request, response) => {
    void handleRequest(request, response, options).catch((error: unknown) => {
      options.logger.error("[control] 请求处理异常", error);
      if (!response.headersSent) {
        sendJson(response, 500, { ok: false, error: "bot 内部错误。" });
      } else {
        response.destroy();
      }
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 20_000;
  server.keepAliveTimeout = 5_000;

  const port = options.port ?? BOT_CONTROL_DEFAULT_PORT;
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  let stopping: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    stop() {
      if (stopping) return stopping;
      stopping = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      return stopping;
    },
  };
}
