import { defineEventHandler, setHeader, setResponseStatus } from "h3";
import { readPublicStatus } from "../utils/publicStatus.ts";

/** 公开只读探针：返回脱敏后的核心依赖健康状态，不要求登录态。 */
export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  const { statusCode, body } = await readPublicStatus();
  setResponseStatus(event, statusCode);
  return body;
});
