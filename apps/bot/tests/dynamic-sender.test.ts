import { expect, test } from "vite-plus/test";
import { sendDynamicToGroups } from "../src/dynamic/index.ts";
import type { FormattedDynamic } from "../src/dynamic/index.ts";
import type { MessagePart } from "../src/message/parts.ts";
import type { FeatureContext } from "../src/core/index.ts";

interface RecordedSend {
  groupId: number;
  purpose: string;
  parts: MessagePart[];
}

function makeContext(behavior: { failWithImages: boolean; failAlways: boolean }): {
  context: FeatureContext;
  sends: RecordedSend[];
} {
  const sends: RecordedSend[] = [];
  const context = {
    accountId: "acc",
    adminGroupId: undefined,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    async sendGroupMsg(groupId: number, options: { purpose: string }, messages: MessagePart[]) {
      const hasImage = messages.some((m) => m.type === "image");
      if (behavior.failAlways) throw new Error("彻底失败");
      if (behavior.failWithImages && hasImage) throw new Error("图片上传失败");
      sends.push({ groupId, purpose: options.purpose, parts: messages });
      return `群${groupId}`;
    },
  } as unknown as FeatureContext;
  return { context, sends };
}

const formatted: FormattedDynamic = {
  purpose: "dynamic.opus",
  summary: "UP：正文",
  subject: "UP",
  text: "UP 发布了新动态\n正文\nhttps://t.bilibili.com/1",
  coverUrl: null,
  imageUrls: ["https://x/a.jpg", "https://x/b.jpg", "https://x/c.jpg"],
  url: "https://t.bilibili.com/1",
};

test("NapCat 通道单条消息带最多三张图片", async () => {
  const { context, sends } = makeContext({ failWithImages: false, failAlways: false });
  const result = await sendDynamicToGroups({ context, provider: "napcat" }, formatted, [123]);
  expect(result.delivered).toBe(true);
  expect(sends).toHaveLength(1);
  const images = sends[0].parts.filter((p) => p.type === "image");
  expect(images).toHaveLength(3);
});

test("官方通道只发一张图片（单图限制）", async () => {
  const { context, sends } = makeContext({ failWithImages: false, failAlways: false });
  await sendDynamicToGroups({ context, provider: "official" }, formatted, [123]);
  const images = sends[0].parts.filter((p) => p.type === "image");
  expect(images).toHaveLength(1);
});

test("图片失败时降级为纯文本（含原链接），通知不丢失", async () => {
  const { context, sends } = makeContext({ failWithImages: true, failAlways: false });
  const result = await sendDynamicToGroups({ context, provider: "napcat" }, formatted, [123]);
  expect(result.delivered).toBe(true);
  expect(sends).toHaveLength(1);
  expect(sends[0].parts.some((p) => p.type === "image")).toBe(false);
  expect((sends[0].parts[0] as { text: string }).text).toContain("https://t.bilibili.com/1");
  expect(result.errors.length).toBeGreaterThan(0);
});

test("彻底失败时 delivered=false 并记录错误", async () => {
  const { context } = makeContext({ failWithImages: false, failAlways: true });
  const result = await sendDynamicToGroups({ context, provider: "napcat" }, formatted, [123]);
  expect(result.delivered).toBe(false);
  expect(result.errors.length).toBeGreaterThan(0);
});

test("单个群失败不影响其它群", async () => {
  const sends: number[] = [];
  let calls = 0;
  const context = {
    accountId: "acc",
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    async sendGroupMsg(groupId: number) {
      calls += 1;
      if (groupId === 111) throw new Error("坏群");
      sends.push(groupId);
      return `群${groupId}`;
    },
  } as unknown as FeatureContext;
  const result = await sendDynamicToGroups(
    { context, provider: "napcat" },
    { ...formatted, imageUrls: [] },
    [111, 222],
  );
  expect(sends).toEqual([222]);
  expect(result.delivered).toBe(true);
  expect(result.errors.length).toBe(1);
  expect(calls).toBe(2);
});
