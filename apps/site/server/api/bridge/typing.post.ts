import { createError, defineEventHandler, readBody } from "h3";
import { z } from "zod";
import { postBridgeTyping, requireBridgeKey } from "../../utils/bridge.ts";

const schema = z
  .object({
    accountId: z.string().min(1),
    seconds: z.number().int().min(1).max(60).default(10),
  })
  .strict();

/** 给已绑定的主人发「输入中」状态。只认桥接专用口令。 */
export default defineEventHandler(async (event) => {
  requireBridgeKey(event);
  const parsed = schema.safeParse(await readBody<unknown>(event));
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: "请求参数不合法，只支持 accountId 与 seconds（1-60）",
    });
  }
  return postBridgeTyping(parsed.data.accountId, parsed.data.seconds);
});
