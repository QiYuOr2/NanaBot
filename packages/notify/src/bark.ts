import { barkURL } from "@nana/utils";
import { ENV_KEYS } from "@nana/constants";
import type { Notifier, NotifyMessage } from "./types.ts";

export interface BarkNotifierOptions {
  /** Bark 分组名，可选。 */
  group?: string;
}

interface BarkNotifierDeps {
  /** 测试注入点：替换真实 fetch。 */
  fetch?: typeof globalThis.fetch;
}

/** 创建基于 Bark 的通知通道（复用 @nana/utils 的 barkURL）。 */
export function createBarkNotifier(
  options: BarkNotifierOptions = {},
  deps: BarkNotifierDeps = {},
): Notifier {
  const doFetch = deps.fetch ?? globalThis.fetch;

  return {
    async send(message: NotifyMessage) {
      const key = process.env[ENV_KEYS.BARK_KEY];
      if (!key) {
        console.warn("[barkNotifier] 缺少环境变量 BARK_KEY，Bark 通知将跳过。");
        return;
      }

      const url = barkURL({
        title: message.subject,
        content: message.text,
        group: options.group ?? "",
      });

      try {
        const response = await doFetch(url);
        if (!response.ok) {
          throw new Error(`Bark 推送失败: HTTP ${response.status}`);
        }
      } catch (error) {
        console.error("[barkNotifier] 发送失败", error);
      }
    },
  };
}
