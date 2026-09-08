import type { Notifier, NotifyMessage } from "./types.ts";

/** 把多个通知通道聚合为一个，依次发送同一消息。 */
export function createCompositeNotifier(notifiers: Notifier[]): Notifier {
  return {
    async send(message: NotifyMessage) {
      for (const notifier of notifiers) {
        await notifier.send(message);
      }
    },
    async close() {
      await Promise.all(notifiers.map((notifier) => notifier.close?.() ?? Promise.resolve()));
    },
  };
}
