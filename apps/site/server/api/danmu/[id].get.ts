import { createError, defineEventHandler, getRouterParam } from "h3";
import type { DanmuSessionDetailResponse } from "../../../shared/danmu.ts";
import { buildDanmuSessionDetail } from "../../utils/danmu.ts";

export default defineEventHandler((event): DanmuSessionDetailResponse => {
  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "无效的场次 ID" });
  }

  const detail = buildDanmuSessionDetail(id);
  if (!detail) {
    throw createError({ statusCode: 404, statusMessage: "未找到该弹幕场次" });
  }

  return detail;
});
