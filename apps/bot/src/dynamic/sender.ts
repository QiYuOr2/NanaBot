import type { MessagePart } from "../message/parts.ts";
import { imagePart, textPart } from "../message/parts.ts";
import type { FeatureContext } from "../core/index.ts";
import type { FormattedDynamic } from "./formatter.ts";
import { MAX_IMAGES } from "./formatter.ts";

export type QQProvider = "official" | "napcat";

/**
 * 各通道单条消息可携带的图片上限。
 *
 * - NapCat：单条消息支持多张图片，按 `MAX_IMAGES` 上限发送。
 * - 官方 QQ：单条消息仅允许一张图片（SDK 层对多图直接报错），因此只发一张。
 */
const IMAGE_LIMIT_BY_PROVIDER: Record<QQProvider, number> = {
  napcat: MAX_IMAGES,
  official: 1,
};

export interface DynamicSenderDeps {
  context: FeatureContext;
  provider: QQProvider;
}

export interface SendResult {
  /** 是否至少有一条群推送成功。 */
  delivered: boolean;
  /** 发送中出现的错误（供上层记录，不抛出以免影响其它群）。 */
  errors: string[];
}

/**
 * 把一条格式化后的动态发送到指定群列表。
 *
 * 行为约定（对应设计文档「图片失败降级为文本 + 原动态链接」「不能因图片失败丢失整条通知」）：
 * 1. 先组装「文本 + 图片」消息；图片数量按通道能力上限截断。
 * 2. 带图发送失败时，降级为纯文本（文本本身已含原动态链接）重发一次。
 * 3. 文本发送仍失败则记录错误；单个群失败不影响其它群。
 *
 * 发送走 `context.sendGroupMsg`，由现有推送客户端统一写 push-log，不新建连接或日志表。
 */
export async function sendDynamicToGroups(
  deps: DynamicSenderDeps,
  formatted: FormattedDynamic,
  groupIds: readonly number[],
): Promise<SendResult> {
  const errors: string[] = [];
  let delivered = false;
  if (groupIds.length === 0) {
    return { delivered: false, errors };
  }

  const optionBase = {
    purpose: formatted.purpose,
    content: formatted.summary,
    subject: formatted.subject,
  } as const;

  const imageSources = pickImages(deps.provider, formatted);

  for (const groupId of groupIds) {
    const textPartMessage = textPart(formatted.text);
    const withImages: MessagePart[] = [
      textPartMessage,
      ...imageSources.map((src) => imagePart(src)),
    ];

    if (imageSources.length > 0) {
      try {
        await deps.context.sendGroupMsg(groupId, optionBase, withImages);
        delivered = true;
        continue;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`群 ${groupId} 带图推送失败，降级为纯文本：${message}`);
        deps.context.logger.warn(
          `[动态监控] 群 ${groupId} 带图推送失败，降级为纯文本：${formatted.url}`,
          error,
        );
      }
    }

    // 无图片，或带图失败后的纯文本降级。文本已包含原动态链接。
    try {
      await deps.context.sendGroupMsg(groupId, optionBase, [textPartMessage]);
      delivered = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`群 ${groupId} 推送失败：${message}`);
      deps.context.logger.error(
        `[动态监控] 群 ${groupId} 推送动态失败：${formatted.summary}`,
        error,
      );
    }
  }

  return { delivered, errors };
}

/** 按通道能力挑选图片来源：图文用图片，视频/专栏用封面。 */
function pickImages(provider: QQProvider, formatted: FormattedDynamic): string[] {
  const limit = IMAGE_LIMIT_BY_PROVIDER[provider];
  const candidates =
    formatted.imageUrls.length > 0
      ? formatted.imageUrls
      : formatted.coverUrl
        ? [formatted.coverUrl]
        : [];
  return candidates.slice(0, limit);
}
