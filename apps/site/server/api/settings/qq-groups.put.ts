import { createError, defineEventHandler, readBody } from "h3";
import { QQGroupConflictError, QQGroupMappingSchema, saveQQGroupMapping } from "@nana/config";
import { requireSiteConfigToken } from "../../utils/configAuth.ts";

export default defineEventHandler(async (event) => {
  requireSiteConfigToken(event);
  const parsed = QQGroupMappingSchema.safeParse(await readBody<unknown>(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: "请填写有效的群标识与群名称" });
  try {
    saveQQGroupMapping(parsed.data);
  } catch (error) {
    if (error instanceof QQGroupConflictError)
      throw createError({ statusCode: 409, statusMessage: error.message });
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : "保存失败",
    });
  }
  return { saved: true };
});
