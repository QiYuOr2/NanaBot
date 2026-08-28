import { createError, defineEventHandler, getRouterParam } from "h3";
import { refreshStreamer } from "../../utils/streamers.ts";

export default defineEventHandler(async (event) => {
  const roomId = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(roomId) || roomId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "无效的房间号" });
  }

  const refreshed = await refreshStreamer(roomId);
  if (!refreshed) {
    throw createError({ statusCode: 404, statusMessage: "未找到该主播或查询不到直播详情" });
  }

  return refreshed;
});
