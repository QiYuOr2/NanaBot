import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { QQBot } from "@tencent-connect/qqbot-nodejs";
import { Structs } from "node-napcat-ts";
import { readPushLogs } from "@nana/storage";
import { OfficialPushClient } from "../src/qq/push.ts";
import { parseQQConfig, resolveOfficialAccounts } from "../src/qq/config.ts";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function harness(failMessages = false) {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-official-"));
  roots.push(rootDir);
  writeFileSync(join(rootDir, "nana.config.yaml"), "{}");
  const requests: { url: string; body: Record<string, unknown>; auth?: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      if (typeof init.body !== "string") throw new Error("Expected JSON request body");
      const body = JSON.parse(init.body);
      const url = String(input);
      requests.push({
        url,
        body,
        auth: new Headers(init.headers).get("Authorization") ?? undefined,
      });
      if (url.endsWith("/app/getAppAccessToken"))
        return Response.json({ access_token: "test-token", expires_in: 7200 });
      if (url.endsWith("/files"))
        return Response.json({ file_uuid: "file-1", file_info: "uploaded-image", ttl: 300 });
      if (url.endsWith("/messages"))
        return failMessages
          ? Response.json({ code: 40034010, message: "群未允许主动发言" }, { status: 400 })
          : Response.json({ id: "message-1", timestamp: new Date().toISOString() });
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  const [account] = resolveOfficialAccounts(
    parseQQConfig({
      qq: {
        accounts: [
          {
            id: "official",
            groups: { 123: { openid: "GROUP_OPENID", name: "直播群" } },
          },
        ],
      },
    }).accounts,
    { QQ_BOT_APP_ID: "123456", QQ_BOT_APP_SECRET: "test-secret" },
  );
  const bot = new QQBot({ appId: account.appId, appSecret: account.appSecret });
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    rootDir,
    requests,
    logger,
    client: new OfficialPushClient(bot, account, { rootDir }, logger),
  };
}

test("真实 SDK 鉴权与群主动消息请求使用 openid，成功落库，省略 @all", async () => {
  const { client, rootDir, requests, logger } = harness();
  await client.sendGroupMsg(123, { purpose: "live.start", content: "开播", subject: "饭总" }, [
    Structs.text("开播"),
    Structs.at("all"),
  ]);
  expect(requests).toEqual([
    expect.objectContaining({
      url: "https://bots.qq.com/app/getAppAccessToken",
      body: { appId: "123456", clientSecret: "test-secret" },
    }),
    expect.objectContaining({
      url: "https://api.sgroup.qq.com/v2/groups/GROUP_OPENID/messages",
      auth: "QQBot test-token",
      body: expect.objectContaining({ msg_type: 0, content: "开播" }),
    }),
  ]);
  expect(requests[1].body).not.toHaveProperty("msg_id");
  expect(logger.warn).toHaveBeenCalledOnce();
  expect(readPushLogs({ rootDir })).toEqual([
    expect.objectContaining({
      account: "official",
      targetId: "GROUP_OPENID",
      target: "直播群",
      success: true,
      purpose: "live.start",
      subject: "饭总",
    }),
  ]);
});

test("词云本地图片经 SDK 上传后作为带正文的媒体消息发送", async () => {
  const { client, rootDir, requests } = harness();
  const imagePath = join(rootDir, "wordcloud.png");
  writeFileSync(imagePath, Buffer.from("test-image"));
  await client.sendGroupMsg(123, { purpose: "wordcloud" }, [
    Structs.text("场次统计"),
    Structs.image(imagePath),
  ]);
  expect(requests.find((r) => r.url.endsWith("/files"))?.body).toMatchObject({
    file_type: 1,
    srv_send_msg: false,
    file_data: Buffer.from("test-image").toString("base64"),
  });
  expect(requests.at(-1)?.body).toMatchObject({
    msg_type: 7,
    content: "场次统计",
    media: { file_info: "uploaded-image" },
  });
  expect(readPushLogs({ rootDir })[0]).toMatchObject({ purpose: "wordcloud", success: true });
});

test("平台权限拒绝记为失败并向调用方抛出，允许业务降级", async () => {
  const { client, rootDir } = harness(true);
  await expect(
    client.sendGroupMsg(123, { purpose: "live.summary" }, [Structs.text("摘要")]),
  ).rejects.toThrow();
  expect(readPushLogs({ rootDir })[0]).toMatchObject({
    success: false,
    purpose: "live.summary",
    error: expect.stringContaining("群未允许主动发言"),
  });
});

test("缺失路由或不支持的消息段不会发到其他群，也不会记为成功", async () => {
  const { client, rootDir, requests } = harness();
  await expect(
    client.sendGroupMsg(456, { purpose: "notification" }, [Structs.text("test")]),
  ).rejects.toThrow("group_openid");
  await expect(
    client.sendGroupMsg(123, { purpose: "notification" }, [Structs.face(1)]),
  ).rejects.toThrow("不支持");
  expect(requests).toHaveLength(0);
  expect(readPushLogs({ rootDir }).every((log) => !log.success)).toBe(true);
});
