import { createError, defineEventHandler, getQuery } from "h3";
import { readProjectLogs } from "../utils/projectLogs.ts";

export default defineEventHandler((event) => {
  const query = getQuery(event);
  if (query.file !== undefined && typeof query.file !== "string")
    throw createError({ statusCode: 400, statusMessage: "日志文件参数无效" });
  return readProjectLogs(query.file, Number(query.lines ?? 500));
});
