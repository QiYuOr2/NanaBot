import { afterEach, expect, test, vi } from "vite-plus/test";
import { QQClient } from "../src/index.ts";
import { QQSendError } from "../src/errors.ts";
import type { QQMessagePart } from "../src/types.ts";

afterEach(() => vi.unstubAllGlobals());

function harness(
  response: unknown = { id: "sent-1", timestamp: "2026-11-12T08:00:00+08:00" },
  status = 200,
  sandbox = false,
) {
  const requests: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (typeof init.body !== "string") throw new Error("Expected JSON body");
      requests.push({
        url,
        auth: new Headers(init.headers).get("authorization"),
        body: JSON.parse(init.body),
      });
      if (url.endsWith("/app/getAppAccessToken"))
        return Response.json({ access_token: "test-token", expires_in: 7200 });
      if (url.endsWith("/files"))
        return Response.json({ file_uuid: "file", file_info: "image-info", ttl: 300 });
      if (url.endsWith("/messages")) return Response.json(response, { status });
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  return { requests, client: new QQClient({ appId: "app", appSecret: "secret", sandbox }) };
}

test("独立消息类型经 SDK 鉴权并编码 @全体，只发送一条主动群消息", async () => {
  const { client, requests } = harness();
  const sent = await client.sendGroupMessage("GROUP", [
    { type: "text", text: "开播 " },
    { type: "atAll" },
    { type: "text", text: " 请查看" },
    { type: "atAll" },
  ]);
  expect(sent).toEqual({ id: "sent-1", timestamp: "2026-11-12T08:00:00+08:00" });
  expect(requests[0].body).toEqual({ appId: "app", clientSecret: "secret" });
  expect(requests[1]).toMatchObject({
    url: "https://api.sgroup.qq.com/v2/groups/GROUP/messages",
    auth: "QQBot test-token",
    body: { msg_type: 0, content: "开播 <qqbot-at-everyone /> 请查看" },
  });
  expect(requests[1].body).not.toHaveProperty("msg_id");
  expect(requests).toHaveLength(2);
});

test.each([
  {
    name: "HTTP 权限错误",
    response: { code: 40034105, message: "无权限" },
    status: 403,
    code: 40034105,
  },
  {
    name: "HTTP 200 业务错误",
    response: { code: 40034100, message: "超出频控" },
    status: 200,
    code: 40034100,
  },
  {
    name: "err_code 业务错误",
    response: { err_code: 12345, message: "消息被拒绝" },
    status: 200,
    code: 12345,
  },
  { name: "缺少消息 ID", response: {}, status: 200, code: undefined },
])("$name 统一为 QQSendError，不去除 @全体后重发", async ({ response, status, code }) => {
  const { client, requests } = harness(response, status);
  const error = await client
    .sendGroupMessage("GROUP", [{ type: "atAll" }, { type: "text", text: "开播" }])
    .catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(QQSendError);
  expect(error).toMatchObject({ code });
  expect(requests.filter((request) => request.url.endsWith("/messages"))).toHaveLength(1);
});

test.each([{ source: new Uint8Array([1, 2, 3]) }, { source: "base64://AQID" }])(
  "字节与 base64 图片走官方上传和媒体发送流程",
  async ({ source }) => {
    const { client, requests } = harness();
    await client.sendGroupMessage("GROUP", [
      { type: "text", text: "词云" },
      { type: "image", source },
    ]);
    expect(requests.find((request) => request.url.endsWith("/files"))?.body).toMatchObject({
      file_data: "AQID",
      srv_send_msg: false,
      file_type: 1,
    });
    expect(requests.at(-1)?.body).toMatchObject({
      msg_type: 7,
      content: "词云",
      media: { file_info: "image-info" },
    });
  },
);

test("沙箱选项统一应用于群消息接口", async () => {
  const { client, requests } = harness({ id: "sandbox-message" }, 200, true);
  await client.sendGroupMessage("GROUP", [{ type: "text", text: "测试" }]);
  expect(requests.at(-1)?.url).toBe("https://sandbox.api.sgroup.qq.com/v2/groups/GROUP/messages");
});

test.each<{ name: string; openid: string; parts: QQMessagePart[] }>([
  { name: "空群标识", openid: " ", parts: [{ type: "text", text: "消息" }] },
  { name: "空正文", openid: "GROUP", parts: [{ type: "text", text: " " }] },
  {
    name: "图片合并 @全体",
    openid: "GROUP",
    parts: [{ type: "atAll" }, { type: "image", source: "image.png" }],
  },
  {
    name: "多图片",
    openid: "GROUP",
    parts: [
      { type: "image", source: "a.png" },
      { type: "image", source: "b.png" },
    ],
  },
])("$name 在发出 API 请求前明确失败", async ({ openid, parts }) => {
  const { client, requests } = harness();
  await expect(client.sendGroupMessage(openid, parts)).rejects.toBeInstanceOf(QQSendError);
  expect(requests).toEqual([]);
});
