import { createError, defineEventHandler, readBody } from "h3";
import { z } from "zod";
import { QQGroupMappingSchema } from "@nana/config";
import { requireSiteConfigToken } from "../../../utils/configAuth.ts";
import { sendQQTestMessage } from "../../../utils/qqTestMessage.ts";

const schema = QQGroupMappingSchema.pick({ accountId: true, groupId: true, expectedOpenid: true })
  .extend({
    kind: z.enum(["text", "atAll"]),
  })
  .strict();

export default defineEventHandler(async (event) => {
  requireSiteConfigToken(event);
  const parsed = schema.safeParse(await readBody<unknown>(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: "请选择有效的账号、群与测试消息类型" });
  return sendQQTestMessage(parsed.data);
});
