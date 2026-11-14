import { createError, defineEventHandler, getQuery } from "h3";
import { fetchBridgeStatus } from "../../utils/bridge.ts";

function parseLongPollParam(raw: unknown, name: string, max: number): number | undefined {
  if (raw === undefined) return undefined;
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw createError({ statusCode: 400, statusMessage: `${name} 参数不合法` });
  }
  return value;
}

/** 桥接状态探针：只返回是否已绑定与最近入站 seq，不含任何消息内容，因此不设口令。支持 since/wait 长轮询。 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const account = query.account;
  if (typeof account !== "string" || !account) {
    throw createError({ statusCode: 400, statusMessage: "缺少 account 参数" });
  }
  const since = parseLongPollParam(query.since, "since", Number.MAX_SAFE_INTEGER);
  const wait = parseLongPollParam(query.wait, "wait", 55);
  return fetchBridgeStatus(account, { since, wait });
});
