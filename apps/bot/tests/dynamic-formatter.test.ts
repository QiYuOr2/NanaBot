import { expect, test } from "vite-plus/test";
import {
  formatDynamic,
  MAX_SUMMARY_CHARS,
  purposeForType,
  truncateByCodePoint,
} from "../src/dynamic/index.ts";
import type { BilibiliDynamic } from "@nana/bilibili-api";

function base(overrides: Partial<BilibiliDynamic>): BilibiliDynamic {
  return {
    id: "1",
    uid: 10001,
    authorName: "UP主",
    authorFace: null,
    type: "video",
    publishedAt: "2026-01-01T00:00:00.000Z",
    text: "",
    title: null,
    url: "https://t.bilibili.com/1",
    coverUrl: null,
    imageUrls: [],
    ...overrides,
  };
}

test("按码点截断不破坏 emoji", () => {
  const text = "😀😀😀😀";
  expect(truncateByCodePoint(text, 2)).toBe("😀😀…");
  expect(truncateByCodePoint("abc", 10)).toBe("abc");
});

test("视频动态格式化含标题与链接", () => {
  const formatted = formatDynamic(
    base({ type: "video", title: "视频标题", coverUrl: "https://x/cover.jpg" }),
  );
  expect(formatted.purpose).toBe("dynamic.video");
  expect(formatted.text).toContain("UP主 发布了新视频");
  expect(formatted.text).toContain("视频标题");
  expect(formatted.text).toContain("https://t.bilibili.com/1");
  expect(formatted.coverUrl).toBe("https://x/cover.jpg");
});

test("图文动态格式化含正文摘要与最多三张图", () => {
  const formatted = formatDynamic(
    base({
      type: "opus",
      text: "正文内容",
      imageUrls: ["a", "b", "c", "d"],
    }),
  );
  expect(formatted.purpose).toBe("dynamic.opus");
  expect(formatted.text).toContain("UP主 发布了新动态");
  expect(formatted.text).toContain("正文内容");
  expect(formatted.imageUrls).toHaveLength(3);
});

test("draw 归入图文动态 purpose", () => {
  expect(purposeForType("draw")).toBe("dynamic.opus");
  expect(purposeForType("video")).toBe("dynamic.video");
  expect(purposeForType("article")).toBe("dynamic.article");
});

test("超长正文按上限截断", () => {
  const long = "字".repeat(MAX_SUMMARY_CHARS + 50);
  const formatted = formatDynamic(base({ type: "opus", text: long }));
  expect(Array.from(formatted.text).length).toBeLessThan(MAX_SUMMARY_CHARS + 60);
  expect(formatted.text).toContain("…");
});
