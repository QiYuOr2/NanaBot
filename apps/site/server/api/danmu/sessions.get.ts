import { defineEventHandler, getQuery } from "h3";
import { resolveDanmuSessionLimit, type DanmuSessionsResponse } from "../../../shared/danmu.ts";
import { buildDanmuSessionList } from "../../utils/danmu.ts";

export default defineEventHandler((event): DanmuSessionsResponse => {
  const limit = resolveDanmuSessionLimit(getQuery(event).limit);
  return { sessions: buildDanmuSessionList(limit), limit };
});
