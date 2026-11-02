import { describe, expect, test } from "vite-plus/test";
import {
  CLOUD_TITLE_BAND_BOTTOM,
  colorForRank,
  createRandom,
  fontSizeForRank,
  layoutWords,
  measureWordWidth,
} from "../src/layout.ts";

const WORDS = [
  { word: "原神", count: 30 },
  { word: "剧情", count: 12 },
  { word: "深渊", count: 5 },
];

describe("createRandom", () => {
  test("同一 seed 产出同一序列", () => {
    const first = createRandom(7);
    const second = createRandom(7);

    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });

  test("不同 seed 产出不同序列，且数值落在 [0, 1)", () => {
    const random = createRandom(1);

    for (let index = 0; index < 20; index += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(createRandom(1)()).not.toBe(createRandom(2)());
  });
});

describe("measureWordWidth", () => {
  test("中文按一个字号宽、ASCII 更窄", () => {
    expect(measureWordWidth("原神", 20)).toBe(40);
    expect(measureWordWidth("ab", 20)).toBeLessThan(measureWordWidth("原神", 20));
  });
});

describe("fontSizeForRank", () => {
  test("排名越靠前字号越大，最小不超过 minFontSize", () => {
    const options = { maxFontSize: 80, minFontSize: 20, width: 1000, height: 620 };

    expect(fontSizeForRank(0, 5, options)).toBe(80);
    expect(fontSizeForRank(4, 5, options)).toBe(20);
    expect(fontSizeForRank(0, 5, options)).toBeGreaterThan(fontSizeForRank(1, 5, options));
  });

  test("只有一个词时直接使用最大字号", () => {
    expect(fontSizeForRank(0, 1, { maxFontSize: 60 })).toBe(60);
  });
});

describe("colorForRank", () => {
  test("最高频是墨色，其余按深色色相轮换，相邻词颜色不同", () => {
    expect(colorForRank(0, 60)).toBe("#171717");
    expect(colorForRank(1, 60)).toBe("#005fcc");
    expect(colorForRank(2, 60)).not.toBe(colorForRank(1, 60));
    expect(colorForRank(59, 60)).not.toBe("#5c5c5c");
  });
});

describe("layoutWords", () => {
  test("所有词都落在画布内", () => {
    const placed = layoutWords(WORDS, { width: 1000, height: 620 });

    expect(placed).toHaveLength(3);
    for (const item of placed) {
      expect(item.x).toBeGreaterThan(0);
      expect(item.x).toBeLessThan(1000);
      expect(item.y).toBeGreaterThan(0);
      expect(item.y).toBeLessThan(620);
    }
  });

  test("有标题时词的占位避开标题", () => {
    const title = "饭总 · 2026/02/27 19:40";
    const words = Array.from({ length: 40 }, (_, index) => ({
      word: `词语${index}`,
      count: 40 - index,
    }));
    const placed = layoutWords(words, { width: 1000, height: 620, title });

    expect(placed.length).toBeGreaterThan(20);
    for (const item of placed) {
      const halfHeight = (item.fontSize / 2) * 1.16;
      expect(item.y - halfHeight).toBeGreaterThanOrEqual(CLOUD_TITLE_BAND_BOTTOM);
    }
  });

  test("同一 seed 布局完全一致", () => {
    expect(layoutWords(WORDS, { seed: 3 })).toEqual(layoutWords(WORDS, { seed: 3 }));
  });

  test("布局不重叠（矩形碰撞检测生效）", () => {
    const words = Array.from({ length: 20 }, (_, index) => ({
      word: `关键词${index}`,
      count: 20 - index,
    }));
    const placed = layoutWords(words, { maxWords: 20 });
    const rects = placed.map((item) => ({
      x: item.x,
      y: item.y,
      halfWidth: (measureWordWidth(item.word, item.fontSize) / 2) * 1.08,
      halfHeight: (item.fontSize / 2) * 1.16,
    }));

    for (let left = 0; left < rects.length; left += 1) {
      for (let right = left + 1; right < rects.length; right += 1) {
        const a = rects[left];
        const b = rects[right];
        if (!a || !b) {
          continue;
        }
        const overlap =
          Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth &&
          Math.abs(a.y - b.y) < a.halfHeight + b.halfHeight;
        expect(overlap).toBe(false);
      }
    }
  });

  test("忽略空词并按 maxWords 截断", () => {
    const words = [{ word: "  ", count: 9 }, ...WORDS];

    expect(layoutWords(words).map((item) => item.word)).toEqual(["原神", "剧情", "深渊"]);
    expect(layoutWords(WORDS, { maxWords: 1 })).toHaveLength(1);
  });
});
