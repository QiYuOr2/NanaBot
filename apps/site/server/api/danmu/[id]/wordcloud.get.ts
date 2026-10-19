import { createError, defineEventHandler, getQuery, getRouterParam, sendWebResponse } from "h3";
import {
  DEFAULT_CLOUD_HEIGHT,
  DEFAULT_CLOUD_WIDTH,
  type WordCloudRenderOptions,
} from "@nana/wordcloud";
import {
  DANMU_WORDCLOUD_MAX_WORDS,
  resolveDanmuWordCloudFormat,
} from "../../../../shared/danmu.ts";
import { buildDanmuWordCloudPayload } from "../../../utils/danmu.ts";

/** 与推送词云一致的画布尺寸；页面用 w-full 展示即可保持切图长宽比。 */
const CLOUD_SIZE: Pick<WordCloudRenderOptions, "width" | "height"> = {
  width: DEFAULT_CLOUD_WIDTH,
  height: DEFAULT_CLOUD_HEIGHT,
};

/** 场次结束后词云图不再变化，可以放心让浏览器缓存。 */
const CACHE_CONTROL_PUBLIC = "public, max-age=3600";
/** 进行中的场次内容仍会变化，只做短时缓存，避免反复重算分词与渲染。 */
const CACHE_CONTROL_ACTIVE = "public, max-age=60";

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "无效的场次 ID" });
  }

  const payload = buildDanmuWordCloudPayload(id);
  if (!payload) {
    throw createError({ statusCode: 404, statusMessage: "未找到该弹幕场次" });
  }
  if (payload.words.length === 0) {
    throw createError({ statusCode: 404, statusMessage: "本场没有记录到弹幕，无法生成词云" });
  }

  // 渲染层（jieba / resvg 含原生依赖）只在服务端加载，确保不进入客户端 bundle。
  const { buildWordCloudSvg, renderWordCloudPng } = await import("@nana/wordcloud");
  const svg = buildWordCloudSvg(payload.words, {
    ...CLOUD_SIZE,
    maxWords: DANMU_WORDCLOUD_MAX_WORDS,
    title: payload.title,
  });
  const cacheControl = payload.ended ? CACHE_CONTROL_PUBLIC : CACHE_CONTROL_ACTIVE;

  // 显式 `?format=svg` 直接返回 SVG 文本，便于排查服务端字体问题。
  if (resolveDanmuWordCloudFormat(getQuery(event).format) === "svg") {
    return sendWebResponse(
      event,
      new Response(svg, {
        status: 200,
        headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": cacheControl },
      }),
    );
  }

  let png: Uint8Array<ArrayBuffer>;
  try {
    const buffer = await renderWordCloudPng(svg, { fontPath: payload.fontPath });
    // 拷贝到独立的 ArrayBuffer，保证类型上是规范的 BodyInit。
    png = new Uint8Array(buffer);
  } catch (error) {
    console.error(`[site] 弹幕场次 ${id} 的词云 PNG 渲染失败（常见原因：系统缺少中文字体）`, error);
    throw createError({
      statusCode: 500,
      statusMessage:
        "词云图渲染失败，请检查服务端中文字体或 nana.config.yaml 的 wordcloud.fontPath",
    });
  }

  return sendWebResponse(
    event,
    new Response(png, {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": cacheControl },
    }),
  );
});
