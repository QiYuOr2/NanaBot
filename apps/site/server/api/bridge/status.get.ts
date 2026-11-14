import { createError, defineEventHandler, getQuery } from "h3";
import { fetchBridgeStatus } from "../../utils/bridge.ts";

/** 桥接状态探针：只返回是否已绑定与最近入站 seq，不含任何消息内容，因此不设口令。 */
export default defineEventHandler(async (event) => {
  const account = getQuery(event).account;
  if (typeof account !== "string" || !account) {
    throw createError({ statusCode: 400, statusMessage: "缺少 account 参数" });
  }
  return fetchBridgeStatus(account);
});
