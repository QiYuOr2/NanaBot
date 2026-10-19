import { describe, expect, test } from "vite-plus/test";
import { buildWordCloudSvg, escapeXml } from "../src/index.ts";

const WORDS = [
  { word: "原神", count: 20 },
  { word: "剧情", count: 12 },
  { word: "深渊", count: 5 },
];

describe("buildWordCloudSvg", () => {
  test("输出 1000×620 的 SVG 文档并包含高频词", () => {
    const svg = buildWordCloudSvg(WORDS);

    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('width="1000"');
    expect(svg).toContain('height="620"');
    expect(svg).toContain('viewBox="0 0 1000 620"');
    for (const item of WORDS) {
      expect(svg).toContain(`>${item.word}</text>`);
    }
  });

  test("同一输入与同一 seed 产出完全相同的字符串", () => {
    expect(buildWordCloudSvg(WORDS, { seed: 42 })).toBe(buildWordCloudSvg(WORDS, { seed: 42 }));
    expect(buildWordCloudSvg(WORDS)).toBe(buildWordCloudSvg(WORDS));
  });

  test("不同 seed 会改变布局但仍是同一批词", () => {
    const first = buildWordCloudSvg(WORDS, { seed: 1 });
    const second = buildWordCloudSvg(WORDS, { seed: 99 });

    expect(first).not.toBe(second);
    for (const item of WORDS) {
      expect(second).toContain(item.word);
    }
  });

  test("权重越高的词字号越大", () => {
    const svg = buildWordCloudSvg(WORDS);
    const sizes = WORDS.map((item) => {
      const match = new RegExp(`font-size="(\\d+)"[^>]*>${item.word}</text>`).exec(svg);
      return Number(match?.[1] ?? 0);
    });

    expect(sizes[0]).toBeGreaterThan(sizes[1] ?? 0);
    expect(sizes[1]).toBeGreaterThan(sizes[2] ?? 0);
  });

  test("XML 特殊字符被转义，弹幕内容无法注入标签", () => {
    // 词长必须能排进画布，否则会被布局丢弃；这里用短词覆盖转义本身。
    const svg = buildWordCloudSvg([{ word: "<b>'&'</b>", count: 3 }]);

    expect(svg).toContain("&lt;b&gt;&apos;&amp;&apos;&lt;/b&gt;");
    expect(svg).not.toContain("<b>");
  });

  test("词数为空时只输出背景，不抛错", () => {
    const svg = buildWordCloudSvg([]);

    expect(svg).toContain("<rect");
    expect(svg).not.toContain("<text");
  });

  test("maxWords 限制绘制的词数", () => {
    const words = Array.from({ length: 10 }, (_, index) => ({
      word: `词${index}`,
      count: 10 - index,
    }));
    const svg = buildWordCloudSvg(words, { maxWords: 3 });
    const textCount = svg.split("<text").length - 1;

    expect(textCount).toBe(3);
  });

  test("自定义尺寸与标题生效", () => {
    const svg = buildWordCloudSvg(WORDS, { width: 400, height: 200, title: "本场词云" });

    expect(svg).toContain('width="400"');
    expect(svg).toContain('height="200"');
    expect(svg).toContain(">本场词云</text>");
  });
});

describe("escapeXml", () => {
  test("转义 & < > \" '", () => {
    expect(escapeXml(`a&b<c>"d"'e'`)).toBe("a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;");
  });

  test("剔除 XML 1.0 不允许的控制字符", () => {
    expect(escapeXml("ab\u0000c\u0007d")).toBe("abcd");
  });
});
