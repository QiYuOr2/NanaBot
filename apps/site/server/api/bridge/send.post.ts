import { createError, defineEventHandler, readBody } from "h3";
import { z } from "zod";
import { postBridgeSend, requireBridgeKey } from "../../utils/bridge.ts";

const schema = z
  .object({
    accountId: z.string().min(1),
    text: z.string().trim().max(2_000).optional(),
    markdown: z.string().trim().min(1).max(4_000).optional(),
    image: z.string().trim().min(1).max(8_000_000).optional(),
    voice: z.string().trim().min(1).max(8_000_000).optional(),
  })
  .strict()
  .refine((value) => (value.text ?? "") !== "" || value.markdown || value.image || value.voice, {
    message: "text、markdown、image、voice 至少提供一项。",
  })
  .refine((value) => !(value.markdown && value.image), {
    message: "markdown 与 image 不能同时提供。",
  })
  .refine((value) => !(value.markdown && value.text), {
    message: "markdown 不能与 text 同时提供。",
  })
  .refine((value) => !(value.voice && (value.text || value.markdown || value.image)), {
    message: "voice 不能与 text、markdown、image 同时提供。",
  });

/** 经 bot 向已绑定的主人发送一条私聊（纯文本 / Markdown / 图片 / 语音）。只认桥接专用口令。 */
export default defineEventHandler(async (event) => {
  requireBridgeKey(event);
  const parsed = schema.safeParse(await readBody<unknown>(event));
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "请求参数不合法：支持 accountId 与 text / markdown / image / voice（互斥规则见接口说明）",
    });
  }
  const { accountId, ...message } = parsed.data;
  return postBridgeSend(accountId, message);
});
