import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { QQClient } from "@nana/qq";
import { Structs } from "node-napcat-ts";
import { readPushLogs } from "@nana/storage";
import { loadOfficialGroups, saveQQGroupMapping } from "@nana/config";
import { OfficialPushClient } from "../src/qq/push.ts";
import { parseQQConfig, resolveOfficialAccounts } from "../src/qq/config.ts";
import { createNapcatMonitorSink } from "../src/monitor/sinks/napcat.ts";
import type { FeatureContext } from "../src/core/feature.ts";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function harness(
  failMessages: boolean | { code: number; message: string; status: number } = false,
) {
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
          ? Response.json(
              typeof failMessages === "object"
                ? { code: failMessages.code, message: failMessages.message }
                : { code: 40034105, message: "群未允许主动发言" },
              { status: typeof failMessages === "object" ? failMessages.status : 400 },
            )
          : Response.json({ id: "message-1", timestamp: new Date().toISOString() });
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  const [account] = resolveOfficialAccounts(
    parseQQConfig({
      accounts: [
        {
          id: "official",
          provider: "official",
          official: {},
          groups: { 123: { openid: "GROUP_OPENID", name: "直播群" } },
        },
      ],
    }).accounts,
    { QQ_BOT_APP_ID: "123456", QQ_BOT_APP_SECRET: "test-secret" },
  );
  const transport = new QQClient({ appId: account.appId, appSecret: account.appSecret });
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    rootDir,
    requests,
    logger,
    transport,
    account,
    client: new OfficialPushClient(transport, account, { rootDir }, logger),
  };
}

test("真实 SDK 群主动消息使用官方 @全体标记并保留正文，成功落库", async () => {
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
      body: expect.objectContaining({ msg_type: 0, content: "开播<qqbot-at-everyone />" }),
    }),
  ]);
  expect(requests[1].body).not.toHaveProperty("msg_id");
  expect(logger.warn).not.toHaveBeenCalled();
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

test.each([
  { adminGroupId: undefined, content: "饭总播了 <qqbot-at-everyone />" },
  { adminGroupId: 123, content: "饭总播了" },
])(
  "开播模板 {@all} 经监控链路发送，管理群沿用免打扰：adminGroupId=$adminGroupId",
  async ({ adminGroupId, content }) => {
    const { client, rootDir, requests, logger } = harness();
    const context: FeatureContext = {
      adminGroupId,
      logger,
      onCleanup() {},
      async sendAdminText() {},
      async sendAdminMsg() {},
      sendGroupMsg: (id, options, messages) => client.sendGroupMsg(id, options, messages),
    };
    await createNapcatMonitorSink(context, [123]).handle({
      type: "live.started",
      roomId: 4629447,
      streamer: "饭总",
      message: "饭总播了 {@all}",
      timestamp: new Date(),
    });
    expect(requests.find((request) => request.url.endsWith("/messages"))?.body).toMatchObject({
      msg_type: 0,
      content,
    });
    expect(readPushLogs({ rootDir })[0]).toMatchObject({
      success: true,
      purpose: "live.start",
      subject: "饭总",
    });
  },
);

test.each([
  { code: 40034105, message: "机器人不是群管理员", status: 400 },
  { code: 40034100, message: "@全体成员每日额度已耗尽", status: 429 },
  { code: 40034105, message: "@全体成员发送被拒绝", status: 200 },
])("@全体被平台拒绝时记录失败，不降级成普通群消息：$message", async (failure) => {
  const { client, rootDir, requests } = harness(failure);
  await expect(
    client.sendGroupMsg(123, { purpose: "live.start" }, [Structs.at("all"), Structs.text("开播")]),
  ).rejects.toThrow(failure.message);
  const sent = requests.filter((request) => request.url.endsWith("/messages"));
  expect(sent).toHaveLength(1);
  expect(sent[0].body.content).toBe("<qqbot-at-everyone />开播");
  expect(readPushLogs({ rootDir })).toEqual([
    expect.objectContaining({ success: false, error: expect.stringContaining(failure.message) }),
  ]);
});

test("@全体与图片不能合成媒体消息，不在不支持的类型中吞掉提醒", async () => {
  const { client, rootDir, requests } = harness();
  await expect(
    client.sendGroupMsg(123, { purpose: "notification" }, [
      Structs.at("all"),
      Structs.image("https://example.com/image.png"),
    ]),
  ).rejects.toThrow("仅支持文本或 Markdown");
  expect(requests).toHaveLength(0);
  expect(readPushLogs({ rootDir })[0].success).toBe(false);
});

test("site 保存映射后同一个发送客户端立即使用新目标，不沿用过期映射", async () => {
  const { rootDir, requests, logger, transport, account } = harness();
  writeFileSync(
    join(rootDir, "nana.config.yaml"),
    JSON.stringify({
      accounts: [
        {
          id: "official",
          provider: "official",
          official: {},
          groups: { 123: { openid: "GROUP_OLD" } },
        },
      ],
    }),
  );
  const client = new OfficialPushClient(transport, account, { rootDir }, logger, () =>
    loadOfficialGroups("official", rootDir),
  );
  await client.sendGroupMsg(123, { purpose: "notification" }, [Structs.text("第一条")]);
  saveQQGroupMapping(
    {
      accountId: "official",
      groupId: "123",
      openid: "GROUP_NEW",
      name: "新群名",
      expectedOpenid: "GROUP_OLD",
    },
    rootDir,
  );
  await client.sendGroupMsg(123, { purpose: "notification" }, [Structs.text("第二条")]);
  expect(
    requests.filter((request) => request.url.endsWith("/messages")).map((request) => request.url),
  ).toEqual([
    "https://api.sgroup.qq.com/v2/groups/GROUP_OLD/messages",
    "https://api.sgroup.qq.com/v2/groups/GROUP_NEW/messages",
  ]);
  writeFileSync(
    join(rootDir, "nana.config.yaml"),
    JSON.stringify({ accounts: [{ id: "official", provider: "official", official: {} }] }),
  );
  await expect(
    client.sendGroupMsg(123, { purpose: "notification" }, [Structs.text("第三条")]),
  ).rejects.toThrow("group_openid");
  expect(requests.filter((request) => request.url.endsWith("/messages"))).toHaveLength(2);
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
