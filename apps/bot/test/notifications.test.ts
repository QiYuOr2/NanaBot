import { expect, test, vi } from "vite-plus/test";
import { parseBotNotifications, renderBotNotice } from "../src/config/notifications.ts";
import { registerStartupNotice } from "../src/core/startupNotice.ts";

const account = { id: "main", name: "主号", provider: "napcat" };
test("默认上线不带名称，下线文案保留", () => {
  const config = parseBotNotifications({});
  expect(renderBotNotice(config.online, account)).toBe("我来了~");
  expect(renderBotNotice(config.offline, account)).toBe("我溜了~");
});

test.each([false, true])("上线仅在首次就绪发送，重连不重复（首次发送失败：%s）", async (fail) => {
  const handlers: (() => void)[] = [];
  const sendAdminText = vi.fn(async () => {
    if (fail) throw new Error("send failed");
  });
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  registerStartupNotice(
    {
      adminGroupId: 123,
      onConnected(handler: () => void) {
        handlers.push(handler);
        return () => {};
      },
      sendAdminText,
    },
    "我来了~",
    logger,
  );
  const connect = () => handlers.forEach((handler) => handler());
  connect();
  connect();
  await vi.waitFor(() => {
    expect(fail ? logger.error : logger.info).toHaveBeenCalledOnce();
  });
  connect();
  expect(sendAdminText).toHaveBeenCalledExactlyOnceWith("我来了~", { purpose: "app.online" });
});

test("关闭上线提醒或缺少管理群时不注册发送回调", () => {
  const onConnected = vi.fn();
  const sendAdminText = vi.fn();
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  registerStartupNotice({ adminGroupId: 123, onConnected, sendAdminText }, undefined, logger);
  registerStartupNotice({ adminGroupId: undefined, onConnected, sendAdminText }, "我来了~", logger);
  expect(onConnected).not.toHaveBeenCalled();
});
test("两种提醒可独立关闭或替换模板", () => {
  const config = parseBotNotifications({
    botNotifications: {
      online: { enabled: false },
      offline: { messageTemplate: "{accountName}（{accountId}/{provider}）下线" },
    },
  });
  expect(renderBotNotice(config.online, account)).toBeUndefined();
  expect(renderBotNotice(config.offline, account)).toBe("主号（main/napcat）下线");
  expect(() =>
    parseBotNotifications({ botNotifications: { online: { messageTemplate: " " } } }),
  ).toThrow();
});
