import { createError, defineEventHandler, readBody } from "h3";
import { z } from "zod";
import { postBridgeSend, requireBridgeKey } from "../../utils/bridge.ts";

const schema = z
  .object({
    accountId: z.string().min(1),
    text: z.string().trim().min(1).max(2_000),
  })
  .strict();

/** 经 bot 向已绑定的主人发送一条私聊。只认桥接专用口令。 */
export default defineEventHandler(async (event) => {
  requireBridgeKey(event);
  const parsed = schema.safeParse(await readBody<unknown>(event));
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: "请求参数不合法，只支持 accountId 与 text",
    });
  }
  return postBridgeSend(parsed.data.accountId, parsed.data.text);
});
