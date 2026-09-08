import { expect, test } from "vite-plus/test";
import { createBarkNotifier } from "../src/index.ts";

function urlText(url: string | URL | Request): string {
  return typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
}

function withBarkKey<T>(run: () => T): T {
  const prev = process.env.BARK_KEY;
  process.env.BARK_KEY = "test-key";
  try {
    return run();
  } finally {
    process.env.BARK_KEY = prev;
  }
}

test("向 Bark 推送标题和正文", async () => {
  const calls: string[] = [];
  const fakeFetch = async (url: string | URL | Request) => {
    calls.push(urlText(url));
    return { ok: true } as Response;
  };

  await withBarkKey(async () => {
    const notifier = createBarkNotifier({ group: "bot" }, { fetch: fakeFetch });
    await notifier.send({ subject: "离线通知", text: "机器人掉线了" });
  });

  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain("test-key");
  expect(calls[0]).toContain("group=bot");
  const decoded = decodeURIComponent(calls[0]);
  expect(decoded).toContain("离线通知");
  expect(decoded).toContain("机器人掉线了");
});

test("缺少 BARK_KEY 时不发请求", async () => {
  const calls: string[] = [];
  const fakeFetch = async (url: string | URL | Request) => {
    calls.push(urlText(url));
    return { ok: true } as Response;
  };

  const notifier = createBarkNotifier({}, { fetch: fakeFetch });
  process.env.BARK_KEY = "";
  await notifier.send({ subject: "x", text: "y" });
  delete process.env.BARK_KEY;

  expect(calls).toHaveLength(0);
});

test("发送失败被吞掉，不向上抛", async () => {
  const fakeFetch = async () => {
    throw new Error("network");
  };

  await withBarkKey(async () => {
    const notifier = createBarkNotifier({}, { fetch: fakeFetch });
    await expect(notifier.send({ subject: "x", text: "y" })).resolves.toBeUndefined();
  });
});
