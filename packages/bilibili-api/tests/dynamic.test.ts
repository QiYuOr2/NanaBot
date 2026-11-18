import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { dynamic } from "../src/index.ts";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

const navBody = readFixture("nav.json");
const feedBody = readFixture("feed.json");
const pinnedBody = readFixture("feed-pinned.json");
const malformedBody = readFixture("feed-malformed.json");

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
}

/** 构造一个不访问网络的 fetch：按 URL 返回 nav / feed，并记录请求。 */
function createFakeFetch(
  feedResponse: unknown,
  options: { status?: number; requests?: RecordedRequest[]; onFeed?: () => void } = {},
): typeof globalThis.fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    options.requests?.push({ url, headers });

    if (url.includes("/x/web-interface/nav")) {
      return new Response(JSON.stringify(navBody), {
        status: 200,
        headers: { "content-type": "application/json", "set-cookie": "buvid3=abc; Path=/" },
      });
    }
    if (url.includes("www.bilibili.com")) {
      return new Response("", {
        status: 200,
        headers: { "set-cookie": "buvid3=bootcookie; Path=/" },
      });
    }
    if (url.includes("/x/polymer/web-dynamic/v1/feed/space")) {
      options.onFeed?.();
      const status = options.status ?? 200;
      return new Response(JSON.stringify(feedResponse), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };
}

test("WBI mixin key 与签名参数生成稳定", () => {
  const keys = {
    imgKey: "7cd084941338484aae1ad9425b84077c",
    subKey: "4932caff0ff746eab6f01bf08b70ac45",
  };
  expect(dynamic.computeMixinKey(keys.imgKey, keys.subKey)).toHaveLength(32);

  const signed = dynamic.signWbiParams({ host_mid: "1" }, keys, 1_700_000_000);
  expect(signed.query.startsWith("host_mid=1&wts=1700000000&w_rid=")).toBe(true);
  const wRid = signed.query.split("w_rid=")[1];
  expect(wRid).toMatch(/^[0-9a-f]{32}$/);
});

test("签名对外暴露的键与参数顺序不依赖插入顺序", () => {
  const keys = {
    imgKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    subKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  };
  const a = dynamic.signWbiParams({ host_mid: "9", platform: "web" }, keys, 1_700_000_000);
  const b = dynamic.signWbiParams({ platform: "web", host_mid: "9" }, keys, 1_700_000_000);
  expect(a.query).toBe(b.query);
  // 参数名升序：host_mid < platform < wts
  expect(a.query.startsWith("host_mid=9&platform=web&wts=1700000000")).toBe(true);
});

test("从 key URL 提取文件名", () => {
  expect(
    dynamic.extractWbiKeyFromUrl(
      "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
    ),
  ).toBe("7cd084941338484aae1ad9425b84077c");
});

test("解析视频 / Opus / draw / 专栏 / 转发 / 未知类型", async () => {
  const client = new dynamic.BilibiliDynamicClient({
    fetch: createFakeFetch(feedBody),
    now: () => 1_700_000_000_000,
  });
  const items = await client.fetchUserDynamics(10001);
  expect(items).toHaveLength(6);

  const byType = new Map(items.map((item) => [item.type, item]));
  const video = byType.get("video");
  expect(video?.title).toBe("一个测试视频");
  expect(video?.url).toBe("https://www.bilibili.com/video/BV1xx411c7mD");
  expect(video?.coverUrl).toBe("https://i0.hdslb.com/bfs/archive/cover.jpg");

  const opus = byType.get("opus");
  expect(opus?.text).toBe("这是一条图文动态正文");
  expect(opus?.imageUrls).toEqual([
    "https://i0.hdslb.com/bfs/new_dyn/a.jpg",
    "https://i0.hdslb.com/bfs/new_dyn/b.jpg",
  ]);

  const draw = byType.get("draw");
  expect(draw?.text).toBe("旧式图片动态描述");
  expect(draw?.imageUrls).toHaveLength(3);

  const article = byType.get("article");
  expect(article?.title).toBe("专栏标题");
  expect(article?.url).toBe("https://www.bilibili.com/read/cv123");

  // 转发被识别，不误判成原创视频。
  expect(byType.get("forward")?.type).toBe("forward");
  // 未知类型容错为 unknown，不崩溃。
  expect(byType.get("unknown")?.type).toBe("unknown");
});

test("动态 ID 按字符串保真（超出安全整数范围也不丢精度）", async () => {
  const client = new dynamic.BilibiliDynamicClient({ fetch: createFakeFetch(feedBody) });
  const items = await client.fetchUserDynamics(10001);
  expect(items[0].id).toBe("900000000000000001");
});

test("置顶动态被过滤，不计入结果", async () => {
  const client = new dynamic.BilibiliDynamicClient({ fetch: createFakeFetch(pinnedBody) });
  const items = await client.fetchUserDynamics(10001);
  expect(items).toHaveLength(1);
  expect(items[0].id).toBe("900000000000000102");
  expect(items.some((item) => item.title === "置顶的老视频")).toBe(false);
});

test("畸形条目跳过，不影响整页解析", async () => {
  const client = new dynamic.BilibiliDynamicClient({ fetch: createFakeFetch(malformedBody) });
  const items = await client.fetchUserDynamics(10001);
  // 仅第一条有效（缺 author 或 id 的两条被跳过）。
  expect(items).toHaveLength(1);
  expect(items[0].id).toBe("900000000000000201");
});

test("请求带 WBI 签名参数与浏览器身份头，并携带匿名 Cookie", async () => {
  const requests: RecordedRequest[] = [];
  const client = new dynamic.BilibiliDynamicClient({
    fetch: createFakeFetch(feedBody, { requests }),
    now: () => 1_700_000_000_000,
  });
  await client.fetchUserDynamics(10001);
  const feedRequest = requests.find((request) =>
    request.url.includes("/x/polymer/web-dynamic/v1/feed/space"),
  );
  expect(feedRequest).toBeDefined();
  const url = new URL(feedRequest!.url);
  expect(url.searchParams.get("host_mid")).toBe("10001");
  expect(url.searchParams.get("platform")).toBe("web");
  expect(url.searchParams.get("features")).toBe("itemOpusStyle");
  expect(url.searchParams.get("w_rid")).toMatch(/^[0-9a-f]{32}$/);
  expect(url.searchParams.get("wts")).toBe("1700000000");
  expect(feedRequest!.headers["User-Agent"]).toContain("Chrome/138");
  expect(feedRequest!.headers.Referer).toBe("https://www.bilibili.com/");
  expect(feedRequest!.headers.Cookie).toContain("buvid3=");
});

test("WBI key 只获取一次并缓存（多个 UP 主共享）", async () => {
  const requests: RecordedRequest[] = [];
  const client = new dynamic.BilibiliDynamicClient({
    fetch: createFakeFetch(feedBody, { requests }),
    now: () => 1_700_000_000_000,
  });
  await client.fetchUserDynamics(10001);
  await client.fetchUserDynamics(10002);
  const navRequests = requests.filter((request) => request.url.includes("/web-interface/nav"));
  expect(navRequests).toHaveLength(1);
});

test("-352 签名失效后刷新 key 并重试成功", async () => {
  let feedCalls = 0;
  const signedFirst = new Response(JSON.stringify({ code: -352, message: "请求被拦截" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  const fetchImpl: typeof globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/x/web-interface/nav")) {
      return new Response(JSON.stringify(navBody), { status: 200 });
    }
    if (url.includes("www.bilibili.com")) {
      return new Response("", { status: 200, headers: { "set-cookie": "buvid3=x; Path=/" } });
    }
    feedCalls += 1;
    if (feedCalls === 1) return signedFirst;
    return new Response(JSON.stringify(feedBody), { status: 200 });
  };
  const client = new dynamic.BilibiliDynamicClient({
    fetch: fetchImpl,
    now: () => 1_700_000_000_000,
  });
  const items = await client.fetchUserDynamics(10001);
  expect(feedCalls).toBe(2);
  expect(items.length).toBeGreaterThan(0);
});

test("-412 风控抛错，不会被当作空动态", async () => {
  const client = new dynamic.BilibiliDynamicClient({
    fetch: createFakeFetch({ code: -412, message: "request was banned" }, { status: 412 }),
    now: () => 1_700_000_000_000,
  });
  await expect(client.fetchUserDynamics(10001)).rejects.toMatchObject({
    name: "BilibiliDynamicError",
    kind: "risk-control",
  });
});

test("业务码 -412 通过 body 也按风控处理", async () => {
  const client = new dynamic.BilibiliDynamicClient({
    fetch: createFakeFetch({ code: -412, message: "banned" }),
    now: () => 1_700_000_000_000,
  });
  await expect(client.fetchUserDynamics(10001)).rejects.toMatchObject({ kind: "risk-control" });
});

test("其余业务码 -799 等抛业务错误", async () => {
  const client = new dynamic.BilibiliDynamicClient({
    fetch: createFakeFetch({ code: -799, message: "something" }),
    now: () => 1_700_000_000_000,
  });
  await expect(client.fetchUserDynamics(10001)).rejects.toMatchObject({
    kind: "business",
    code: -799,
  });
});

test("HTTP 500 抛 http 错误", async () => {
  const client = new dynamic.BilibiliDynamicClient({
    fetch: createFakeFetch({}, { status: 500 }),
    now: () => 1_700_000_000_000,
  });
  await expect(client.fetchUserDynamics(10001)).rejects.toMatchObject({ kind: "http" });
});

test("空列表会有限重试，重试后仍空返回空数组", async () => {
  let feedCalls = 0;
  const client = new dynamic.BilibiliDynamicClient({
    fetch: createFakeFetch({ code: 0, data: { items: [] } }, { onFeed: () => (feedCalls += 1) }),
    now: () => 1_700_000_000_000,
    emptyRetries: 3,
    emptyRetryDelayMs: 0,
  });
  const items = await client.fetchUserDynamics(10001);
  expect(items).toEqual([]);
  expect(feedCalls).toBe(3);
});

test("空列表后恢复（第二次返回数据）", async () => {
  let feedCalls = 0;
  const fetchImpl: typeof globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/x/web-interface/nav")) return new Response(JSON.stringify(navBody));
    if (url.includes("www.bilibili.com")) return new Response("", { status: 200 });
    feedCalls += 1;
    const body = feedCalls === 1 ? { code: 0, data: { items: [] } } : feedBody;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const client = new dynamic.BilibiliDynamicClient({
    fetch: fetchImpl,
    now: () => 1_700_000_000_000,
    emptyRetryDelayMs: 0,
  });
  const items = await client.fetchUserDynamics(10001);
  expect(items.length).toBeGreaterThan(0);
});

test("拒绝非正整数 UID", async () => {
  const client = new dynamic.BilibiliDynamicClient({ fetch: createFakeFetch(feedBody) });
  await expect(client.fetchUserDynamics(0)).rejects.toThrow("uid 必须是正整数");
});
