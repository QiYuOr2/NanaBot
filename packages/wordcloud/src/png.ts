import { Resvg } from "@resvg/resvg-js";
import type { RenderPngOptions } from "./types.ts";

/**
 * 把 SVG 渲染成 PNG。
 *
 * 依赖 `@resvg/resvg-js`（原生绑定）。系统没有可用的中文字体时，中文会被渲染成
 * 方块或空白 —— 这种情况由调用方决定降级为纯文字推送；本函数在 resvg 报错时
 * 直接把原始错误抛出，方便调用方记录日志。
 *
 * @param svg `buildWordCloudSvg` 产出的 SVG 字符串
 * @param options 字体文件路径 / 像素密度
 * @returns PNG 二进制内容
 */
export async function renderWordCloudPng(
  svg: string,
  options: RenderPngOptions = {},
): Promise<Buffer> {
  const resvg = new Resvg(svg, {
    // 指定字体目录不可靠（跨平台），这里优先用显式 fontPath，否则交给字体扫描。
    font: {
      fontFiles: options.fontPath ? [options.fontPath] : [],
      loadSystemFonts: !options.fontPath,
      defaultFontFamily: "Microsoft YaHei",
    },
    fitTo: {
      mode: "zoom",
      value: options.pixelDensity ?? 1,
    },
  });

  return Buffer.from(resvg.render().asPng());
}
