import { createError, defineEventHandler, readBody } from "h3";
import { z } from "zod";
import { postBridgeBind, requireBridgeKey } from "../../utils/bridge.ts";

const schema = z
  .object({
    accountId: z.string().min(1),
    senderId: z.string().min(1),
  })
  .strict();

/** 把候选发送者绑定为桥接主人；候选之外的 senderId 由 bot 侧拒绝。只认桥接专用口令。 */
export default defineEventHandler(async (event) => {
  requireBridgeKey(event);
  const parsed = schema.safeParse(await readBody<unknown>(event));
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: "请求参数不合法，只支持 accountId 与 senderId",
    });
  }
  return postBridgeBind(parsed.data.accountId, parsed.data.senderId);
});
