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
 * 词云配色，按词频从高到低：
 * 最高频用墨色压住画面，紧接着的几个高频词用站点强调蓝，其余逐级变灰。
 * 只保留一套明度接近的颜色，不再在深色底上轮换高饱和色。
 */
export const WORDCLOUD_PALETTE: readonly string[] = ["#171717", "#005fcc", "#3d3d3d", "#5c5c5c"];

/** 按排名取色。同一档的词颜色相同，颜色只辅助字号，不单独制造彩虹。 */
export function colorForRank(rank: number, total: number): string {
  const [ink, accent, secondary, quiet] = WORDCLOUD_PALETTE;
  if (total <= 1 || rank <= 0) {
    return ink ?? "#171717";
  }
  const accentUntil = Math.min(4, Math.max(1, Math.floor(total / 8)));
  if (rank <= accentUntil) {
    return accent ?? "#005fcc";
  }
  if (rank <= Math.ceil(total * 0.4)) {
    return secondary ?? "#3d3d3d";
  }
  return quiet ?? "#5c5c5c";
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
  const centerY = height / 2;
  const placedRects: Rect[] = [];
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
        y - rectHalfHeight >= 8 &&
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
