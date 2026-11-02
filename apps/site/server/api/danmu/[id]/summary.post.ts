import { createError, defineEventHandler, getRouterParam } from "h3";
import type { DanmuLiveSummaryResponse } from "../../../../shared/danmu.ts";
import { requestSiteLiveSummary } from "../../../utils/liveSummary.ts";

/** 为已经结束、还没有摘要的场次补生成。已有正文时原样返回，不会再次调用模型，也不会发群。 */
export default defineEventHandler(async (event): Promise<DanmuLiveSummaryResponse> => {
  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "无效的场次 ID" });
  }

  const result = await requestSiteLiveSummary(id);
  if (result.kind === "missing") {
    throw createError({ statusCode: 404, statusMessage: "未找到该弹幕场次" });
  }
  if (result.kind === "active") {
    throw createError({ statusCode: 409, statusMessage: "本场尚未结束，下播后才能生成摘要" });
  }
  if (result.kind === "busy") {
    throw createError({ statusCode: 409, statusMessage: "摘要正在生成，请稍后再试" });
  }

  return {
    summary: {
      status: result.status,
      text: result.status === "ok" ? result.text : null,
    },
    message: result.status === "ok" ? undefined : result.message,
  };
});
