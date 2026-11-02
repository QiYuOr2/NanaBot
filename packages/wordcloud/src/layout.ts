import type { WordCloudRenderOptions } from "./types.ts";

/** 画布默认宽度。 */
export const DEFAULT_CLOUD_WIDTH = 1000;

/** 画布默认高度。 */
export const DEFAULT_CLOUD_HEIGHT = 620;

/** 默认最多绘制多少个词。 */
export const DEFAULT_CLOUD_MAX_WORDS = 60;

/** 默认背景色，与站点画布同色，避免词云变成一块黑底海报。 */
export const DEFAULT_CLOUD_BACKGROUND = "#fafafa";

/** 标题用次级墨色，在浅底上仍能和正文分开。 */
export const DEFAULT_CLOUD_TITLE_COLOR = "#4d4d4d";

/** 标题字号。布局避让和 SVG 绘制共用，避免标题框和实际字形错位。 */
export const CLOUD_TITLE_FONT_SIZE = 22;

/** 标题基线的纵坐标。 */
export const CLOUD_TITLE_BASELINE = 40;

/**
 * 标题下方的禁放线。整条顶栏都不放词，避免只按估算字宽躲开、
 * 真实字形仍然压住标题。
 */
export const CLOUD_TITLE_BAND_BOTTOM = 88;

/** 默认最大字号。 */
export const DEFAULT_CLOUD_MAX_FONT_SIZE = 84;

/** 默认最小字号。 */
export const DEFAULT_CLOUD_MIN_FONT_SIZE = 14;

/** 默认布局随机种子。 */
export const DEFAULT_CLOUD_SEED = 1;

/** 默认中文字体回退链（Windows 微软雅黑 / 黑体，Linux Noto Sans CJK）。 */
export const DEFAULT_CLOUD_FONT_FAMILY: readonly string[] = [
  "Microsoft YaHei",
  "PingFang SC",
  "Noto Sans CJK SC",
  "Noto Sans SC",
  "Source Han Sans SC",
  "WenQuanYi Micro Hei",
  "SimHei",
  "sans-serif",
];

/**
 * 浅底上的词色。都压在可读的深色里，色相分开，避免整片灰分不清。
 * 第一项是最高频词的墨色，后面按排名轮换。
 */
export const WORDCLOUD_PALETTE: readonly string[] = [
  "#171717",
  "#005fcc",
  "#0f766e",
  "#9a3412",
  "#9f1239",
  "#5b21b6",
];

/** 按排名取色。相邻名次颜色不同，小词也不会淡到看不清。 */
export function colorForRank(rank: number, _total?: number): string {
  const palette = WORDCLOUD_PALETTE;
  if (rank <= 0) {
    return palette[0] ?? "#171717";
  }
  const chromatic = palette.slice(1);
  return chromatic[(rank - 1) % chromatic.length] ?? palette[0] ?? "#171717";
}

/**
 * 标题占用的矩形：有标题时占满顶栏整宽。
 * 词的碰撞检测会把它当成已占用区域。
 */
export function titleClearance(title: string, width: number): Rect | undefined {
  const text = title.trim();
  if (text.length === 0) {
    return undefined;
  }
  const bottom = CLOUD_TITLE_BAND_BOTTOM;
  return {
    x: width / 2,
    y: bottom / 2,
    halfWidth: width / 2,
    halfHeight: bottom / 2,
  };
}

/** 一个已排布好的词（坐标为中心点）。 */
export interface PlacedWord {
  word: string;
  count: number;
  /** 字号（px）。 */
  fontSize: number;
  /** 文字填充色。 */
  color: string;
  /** 中心点 X。 */
  x: number;
  /** 中心点 Y。 */
  y: number;
}

/** 碰撞检测用的矩形（以中心点表示）。 */
interface Rect {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

/** mulberry32：短小、确定性的伪随机数生成器，同一 seed 产出同一序列。 */
export function createRandom(seed: number): () => number {
  let state = Math.trunc(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * 估算一个词的渲染宽度。
 *
 * 不依赖 canvas / 字体度量（保证纯字符串、跨平台确定）：
 * CJK 与全角字符按 1 个字号宽，ASCII 按 0.58 个字号宽，其余符号按 0.62。
 */
export function measureWordWidth(word: string, fontSize: number): number {
  let units = 0;
  for (const char of word) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x1100) {
      units += 1;
    } else if (/[\w"'.:;!?@#$%^&*()\-+=/\\|~`[\]{}<>,]/.test(char)) {
      units += 0.58;
    } else {
      units += 0.62;
    }
  }
  return units * fontSize;
}

/** 把词频映射为字号：按频次排名分档，最高档等于 `maxFontSize`。 */
export function fontSizeForRank(
  rank: number,
  total: number,
  options: WordCloudRenderOptions = {},
): number {
  const maxFontSize = options.maxFontSize ?? DEFAULT_CLOUD_MAX_FONT_SIZE;
  const minFontSize = options.minFontSize ?? DEFAULT_CLOUD_MIN_FONT_SIZE;
  if (total <= 1) {
    return maxFontSize;
  }
  const ratio = Math.min(1, Math.max(0, rank / (total - 1)));
  const size = maxFontSize - (maxFontSize - minFontSize) * ratio;
  // 取整到 2 的倍数，避免 SVG 里出现过长小数。
  return Math.max(minFontSize, Math.round(size / 2) * 2);
}

/** 把已排布的词块按螺旋方式铺到画布上，返回各词中心坐标。 */
export function layoutWords(
  words: readonly { word: string; count: number }[],
  options: WordCloudRenderOptions = {},
): PlacedWord[] {
  const width = options.width ?? DEFAULT_CLOUD_WIDTH;
  const height = options.height ?? DEFAULT_CLOUD_HEIGHT;
  const maxWords = options.maxWords ?? DEFAULT_CLOUD_MAX_WORDS;
  const seed = options.seed ?? DEFAULT_CLOUD_SEED;
  const random = createRandom(seed);

  const selected = words.filter((item) => item.word.trim().length > 0).slice(0, maxWords);
  const centerX = width / 2;
  const clearance = titleClearance(options.title ?? "", width);
  const contentTop = clearance ? clearance.y + clearance.halfHeight : 8;
  const centerY = clearance ? (contentTop + height) / 2 : height / 2;
  const placedRects: Rect[] = [];
  if (clearance) {
    placedRects.push(clearance);
  }
  const result: PlacedWord[] = [];

  selected.forEach((item, index) => {
    const fontSize = fontSizeForRank(index, selected.length, options);
    const rectHalfWidth = (measureWordWidth(item.word, fontSize) / 2) * 1.08;
    const rectHalfHeight = (fontSize / 2) * 1.16;
    const color = colorForRank(index, selected.length);

    for (let step = 0; step < 40_000; step += 1) {
      // 阿基米德螺旋：半径随角度线性增长，先密后疏地搜索空位。
      const t = step / 6;
      const radius = 3.6 * t;
      const angle = t + random() * 0.15;
      const x = centerX + Math.cos(angle) * radius * 1.55;
      const y = centerY + Math.sin(angle) * radius;
      const rect: Rect = { x, y, halfWidth: rectHalfWidth, halfHeight: rectHalfHeight };

      const insideCanvas =
        x - rectHalfWidth >= 4 &&
        x + rectHalfWidth <= width - 4 &&
        y - rectHalfHeight >= contentTop &&
        y + rectHalfHeight <= height - 8;

      if (!insideCanvas) {
        continue;
      }
      const overlaps = placedRects.some(
        (other) =>
          Math.abs(other.x - x) < other.halfWidth + rectHalfWidth &&
          Math.abs(other.y - y) < other.halfHeight + rectHalfHeight,
      );
      if (overlaps) {
        continue;
      }

      placedRects.push(rect);
      result.push({
        word: item.word,
        count: item.count,
        fontSize,
        color,
        // 坐标保留 1 位小数，保证输出稳定且体积可控。
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
      });
      break;
    }
  });

  return result;
}
