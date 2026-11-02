import {
  DEFAULT_CLOUD_BACKGROUND,
  DEFAULT_CLOUD_FONT_FAMILY,
  DEFAULT_CLOUD_HEIGHT,
  DEFAULT_CLOUD_TITLE_COLOR,
  DEFAULT_CLOUD_WIDTH,
  layoutWords,
} from "./layout.ts";
import type { WordCloudRenderOptions, WordCount } from "./types.ts";

/** 需要转义的 XML 特殊字符。 */
const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/**
 * XML 1.0 不允许出现的控制字符，渲染前必须剔除，否则 resvg 解析会失败。
 * 这里本来就是要匹配控制字符，因此关闭对应 lint 规则。
 */
// oxlint-disable-next-line no-control-regex
const XML_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

/**
 * 转义 XML 文本 / 属性值，防止弹幕内容注入标签。
 */
export function escapeXml(text: string): string {
  return text
    .replace(XML_CONTROL_CHARS, "")
    .replace(/[&<>"']/gu, (char) => XML_ESCAPES[char] ?? char);
}

/** 把字体列表拼成 SVG 的 `font-family` 属性值（同样做转义）。 */
function fontFamilyValue(families: readonly string[]): string {
  return families.map((family) => (/\s/.test(family) ? `'${family}'` : family)).join(", ");
}

/**
 * 生成词云 SVG 字符串。
 *
 * - 纯字符串拼接，不依赖 DOM / canvas / 字体，结果**完全确定**：
 *   同一输入 + 同一 `seed` 必然产出逐字节相同的字符串。
 * - 1000×620 浅色画布，按词频排名分档字号和颜色，阿基米德螺旋布局 + 矩形碰撞检测，
 *   词数超过 `maxWords` 时只画权重最高的那部分。
 * - 所有文本都经过 {@link escapeXml} 处理；即使弹幕里出现 `<script>` 也只会被当成普通文字。
 *
 * @param words 词频列表（通常是 `extractWords` 的结果）
 * @param options 渲染选项，见 {@link WordCloudRenderOptions}
 * @returns 完整的 SVG 文档字符串
 */
export function buildWordCloudSvg(
  words: readonly WordCount[],
  options: WordCloudRenderOptions = {},
): string {
  const width = options.width ?? DEFAULT_CLOUD_WIDTH;
  const height = options.height ?? DEFAULT_CLOUD_HEIGHT;
  const background = options.background ?? DEFAULT_CLOUD_BACKGROUND;
  const fontFamily = fontFamilyValue(options.fontFamily ?? DEFAULT_CLOUD_FONT_FAMILY);
  const title = options.title?.trim();
  const placed = layoutWords(words, options);

  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
    `<rect width="${width}" height="${height}" fill="${escapeXml(background)}"/>`,
  ];

  if (title) {
    lines.push(
      `<text x="${width / 2}" y="52" fill="${DEFAULT_CLOUD_TITLE_COLOR}" font-size="22" font-family="${escapeXml(fontFamily)}" text-anchor="middle">${escapeXml(title)}</text>`,
    );
  }

  for (const item of placed) {
    lines.push(
      `<text x="${item.x}" y="${item.y}" fill="${escapeXml(item.color)}" font-size="${item.fontSize}" font-family="${escapeXml(fontFamily)}" text-anchor="middle" dominant-baseline="central">${escapeXml(item.word)}</text>`,
    );
  }

  lines.push("</svg>");
  return lines.join("\n");
}
