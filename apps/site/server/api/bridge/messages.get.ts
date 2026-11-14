import { createError, defineEventHandler, getQuery } from "h3";
import { fetchBridgeMessages, requireBridgeKey } from "../../utils/bridge.ts";

/** 读取桥接消息（seq 大于 after）；未绑定时附带候选发送者。只认桥接专用口令。 */
export default defineEventHandler(async (event) => {
  requireBridgeKey(event);
  const query = getQuery(event);
  const account = query.account;
  if (typeof account !== "string" || !account) {
    throw createError({ statusCode: 400, statusMessage: "缺少 account 参数" });
  }
  const after = query.after === undefined ? 0 : Number(query.after);
  if (!Number.isSafeInteger(after) || after < 0) {
    throw createError({ statusCode: 400, statusMessage: "after 参数不合法" });
  }
  return fetchBridgeMessages(account, after);
});
