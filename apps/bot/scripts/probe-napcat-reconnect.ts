/**
 * NapCat 连接诊断探针。
 *
 * 用途：
 * 1. 复现 node-napcat-ts 自身重连的失效路径（重连预算耗尽、失败响应关闭自动重连、
 *    耗尽后 `connect()` 变成空操作并挂起），这些是「NapCat 重登后机器人必须重启」的根因；
 * 2. 用真实的 `ConnectionSupervisor` + 真实 WebSocket 服务器验证自愈：服务器消失再回来，
 *    机器人不需要重启就能重新连上。
 *
 * 运行：`node scripts/probe-napcat-reconnect.ts`（Node 24 原生跑 TS，直接 import 源码，
 * 所以这里用 .ts 而不是 .mjs）。升级 node-napcat-ts 之后可以重跑，确认看门狗是否仍然必要。
 *
 * `ws` 不是本仓库的直接依赖（只是 node-napcat-ts 的依赖），因此从 node-napcat-ts 的位置
 * 解析它，避免写死 pnpm store 里的版本号路径。
 */
import { once } from "node:events";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { NCWebsocket } from "node-napcat-ts";
import { NCWebsocket as NCWebsocketImpl } from "node-napcat-ts";
import { ConnectionSupervisor, type ConnectionLogger } from "../src/core/connection.ts";

const require = createRequire(import.meta.url);
const wsEntry = require.resolve("ws", {
  paths: [dirname(require.resolve("node-napcat-ts"))],
});
const wsModule = (await import(pathToFileURL(wsEntry).href)) as {
  default: { WebSocketServer: new (options: { port: number }) => FakeServer };
};

interface FakeSocket {
  send(data: string): void;
  terminate(): void;
  on(event: "message", handler: (raw: unknown) => void): void;
}

interface FakeServer {
  clients: Set<FakeSocket>;
  on(event: "connection", handler: (socket: FakeSocket) => void): void;
  close(callback: () => void): void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const failures: string[] = [];

function check(label: string, ok: boolean, detail = ""): boolean {
  const mark = ok ? "✔" : "✘";
  console.log(`  ${mark} ${label}${detail ? `（${detail}）` : ""}`);
  if (!ok) {
    failures.push(label);
  }
  return ok;
}

/** 轮询等待条件成立。 */
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await sleep(20);
  }
  return predicate();
}

/** 记录 socket 事件序列，用于观察库自身的重连行为。 */
function instrument(ws: NCWebsocket, label: string) {
  const events: string[] = [];
  ws.on("socket.connecting", () => events.push("connecting"));
  ws.on("socket.open", () => events.push("open"));
  ws.on("socket.close", (event) => events.push(`close(now=${event.reconnection.nowAttempts})`));
  ws.on("socket.error", (event) =>
    events.push(`error(${event.error_type},enable=${event.reconnection.enable})`),
  );
  return {
    events,
    dump: () => console.log(`  ${label}：${events.join(" -> ")}`),
  };
}

function countOpens(ws: NCWebsocket): () => number {
  let opens = 0;
  ws.subscribe("socket.open", () => {
    opens += 1;
  });
  return () => opens;
}

/** 起一个「假 NapCat」：接受连接、按 OneBot 协议回 get_status。 */
async function startFakeNapCat(port: number, options: { failFrameFirst?: boolean } = {}) {
  const server = new wsModule.default.WebSocketServer({ port });
  let connections = 0;

  server.on("connection", (socket) => {
    connections += 1;

    if (options.failFrameFirst && connections === 1) {
      // NapCat 在某些异常下会下发这种「无 echo 的失败响应」，库收到后会永久关闭自动重连。
      socket.send(
        JSON.stringify({
          status: "failed",
          retcode: -1,
          data: null,
          message: "probe",
          echo: null,
        }),
      );
      return;
    }

    socket.on("message", (raw) => {
      const request = JSON.parse(String(raw)) as { action?: string; echo?: string };
      if (request.action !== "get_status") {
        return;
      }
      socket.send(
        JSON.stringify({
          status: "ok",
          retcode: 0,
          data: { online: true, good: true, stat: {} },
          message: "",
          wording: "",
          echo: request.echo,
        }),
      );
    });
  });

  await once(server as never, "listening");

  return {
    connections: () => connections,
    /** 模拟 NapCat 停机：直接掐掉所有连接再关服。 */
    async stop() {
      for (const client of server.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function createClient(
  port: number,
  reconnection: { attempts: number; delay: number },
): NCWebsocket {
  return new NCWebsocketImpl(
    {
      baseUrl: `ws://127.0.0.1:${port}`,
      accessToken: "probe",
      reconnection: { enable: true, ...reconnection },
    },
    false,
  );
}

/** 只保留看门狗的关键日志，避免刷屏。 */
function quietLogger(lines: string[]): ConnectionLogger {
  return {
    info: () => {},
    warn: (message) => lines.push(message),
  };
}

// ---------------------------------------------------------------- 库行为复现

async function probeLibraryExhaustion(): Promise<void> {
  const port = 18111;
  console.log(`\n[1] 库的重连预算：端口 ${port} 无人监听（模拟 NapCat 停机/重登期间）`);
  const ws = createClient(port, { attempts: 3, delay: 200 });
  const probe = instrument(ws, "事件序列");

  void ws.connect();
  await sleep(1600);
  probe.dump();
  check(
    "attempts=3 时库只尝试 3 次连接后彻底停止",
    probe.events.filter((event) => event === "connecting").length === 3,
  );

  const before = probe.events.filter((event) => event === "connecting").length;
  const settled = await Promise.race([
    ws.connect().then(
      () => "settled",
      () => "rejected",
    ),
    sleep(600).then(() => "pending"),
  ]);
  check(
    "重试耗尽后 connect() 不会重连",
    probe.events.filter((e) => e === "connecting").length === before,
  );
  check(
    "重试耗尽后 connect() 返回的 Promise 永不 settle",
    settled === "pending",
    `实际 ${settled}`,
  );

  const revived = await startFakeNapCat(port);
  await ws.reconnect();
  await sleep(300);
  check("reconnect() 能真正恢复连接（看门狗可用的唯一手段）", revived.connections() === 1);

  await ws.disconnect().catch(() => {});
  await revived.stop();
}

async function probeLibraryFailFrame(): Promise<void> {
  const port = 18112;
  console.log(`\n[2] 库遇到 {status:"failed",echo:null}：自动重连被永久关闭`);
  const server = await startFakeNapCat(port, { failFrameFirst: true });
  const ws = createClient(port, { attempts: 5, delay: 200 });
  const probe = instrument(ws, "事件序列");

  void ws.connect();
  await sleep(1600);
  probe.dump();
  check(
    "库收到失败帧后不再自动重连（attempts=5 也只连了 1 次）",
    server.connections() === 1 && probe.events.some((e) => e.startsWith("error(response_error")),
  );

  await ws.disconnect().catch(() => {});
  await server.stop();
}

// ------------------------------------------------------- 端到端自愈验证

async function verifyWatchdogRecovers(port: number, failedFrameFirst: boolean): Promise<boolean> {
  const lines: string[] = [];
  const server = await startFakeNapCat(port, { failFrameFirst: failedFrameFirst });
  const ws = createClient(
    port,
    failedFrameFirst ? { attempts: 5, delay: 100 } : { attempts: 2, delay: 100 },
  );
  const opens = countOpens(ws);
  const supervisor = new ConnectionSupervisor(ws, {
    intervalMs: 40,
    disconnectedIdleMs: 150,
    reconnectCooldownMs: 60,
    inboundIdleMs: 60_000, // 本场景不验证探活，避免互相干扰
    logger: quietLogger(lines),
  });

  supervisor.start();
  const connected = await waitFor(() => opens() === 1, 3000);
  check("首次连接建立", connected);

  // 让 NapCat 消失足够久：库自己的重连预算必然已经耗尽（或被失败帧关掉）。
  await server.stop();
  await waitFor(() => !supervisor.isConnected, 2000);
  await sleep(failedFrameFirst ? 400 : 700);
  check("库已不再自行重连", opens() === 1);

  const revived = await startFakeNapCat(port);
  const recovered = await waitFor(() => opens() >= 2, 3000);
  check(
    "NapCat 回来后无需重启机器人即自动重连",
    recovered,
    `服务器侧连接数 ${revived.connections()}`,
  );

  supervisor.stop();
  await ws.disconnect().catch(() => {});
  await revived.stop();
  return recovered;
}

// ---------------------------------------------------------------------- main

console.log("=== NapCat 连接诊断探针 ===");
await probeLibraryExhaustion();
await probeLibraryFailFrame();

console.log("\n[3] 端到端自愈：重连预算耗尽后由 ConnectionSupervisor 接管");
const scenario1 = await verifyWatchdogRecovers(18121, false);

console.log("\n[4] 端到端自愈：库被失败响应关掉自动重连后由 ConnectionSupervisor 接管");
const scenario2 = await verifyWatchdogRecovers(18122, true);

console.log(
  `\n=== 结果：${failures.length === 0 ? "全部通过" : `${failures.length} 项未通过`} ===`,
);
if (failures.length > 0) {
  console.log(`未通过：${failures.join("、")}`);
}
process.exitCode = failures.length === 0 && scenario1 && scenario2 ? 0 : 1;
