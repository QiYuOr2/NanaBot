import { expect, test } from "vite-plus/test";
import { buildWordCloudSvg, renderWordCloudPng } from "../src/index.ts";

/**
 * `@node-rs/jieba` / `@resvg/resvg-js` 都带原生绑定。
 *
 * 这里用 `import.meta.resolve` 探测模块是否**可解析**（不触发 native 加载）：
 * 依赖未安装时直接跳过整个文件，避免在没装依赖的环境里报错。
 * `import.meta.resolve` 在 Vitest 默认的多线程池里可用，且不做副作用加载。
 */
function isResolvable(specifier: string): boolean {
  try {
    const resolve = (import.meta as ImportMeta & { resolve?: (id: string) => string }).resolve;

    if (typeof resolve !== "function") {
      return false;
    }
    resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

const HAS_RESVG = isResolvable("@resvg/resvg-js");

test.skipIf(!HAS_RESVG)("renderWordCloudPng 渲染出合法 PNG", async () => {
  const svg = buildWordCloudSvg([
    { word: "原神", count: 10 },
    { word: "剧情", count: 4 },
  ]);

  const png = await renderWordCloudPng(svg);

  expect(Buffer.isBuffer(png)).toBe(true);
  // PNG 魔数：89 50 4E 47 0D 0A 1A 0A
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR 中的宽高应与 SVG 画布一致（大端 32 位，偏移 16 / 20）。
  expect(png.readUInt32BE(16)).toBe(1000);
  expect(png.readUInt32BE(20)).toBe(620);
});

test.skipIf(!HAS_RESVG)("renderWordCloudPng 支持 pixelDensity 缩放", async () => {
  const svg = buildWordCloudSvg([{ word: "娜娜", count: 1 }], { width: 200, height: 100 });
  const png = await renderWordCloudPng(svg, { pixelDensity: 2 });

  expect(png.readUInt32BE(16)).toBe(400);
  expect(png.readUInt32BE(20)).toBe(200);
});

test.skipIf(HAS_RESVG)("resvg 未安装时 renderWordCloudPng 直接抛错，由调用方降级", async () => {
  const svg = buildWordCloudSvg([{ word: "原神", count: 1 }]);

  // 依赖缺失时应快速失败（无法动态 import），调用方据此降级为纯文字推送。
  await expect(renderWordCloudPng(svg)).rejects.toBeTruthy();
});
