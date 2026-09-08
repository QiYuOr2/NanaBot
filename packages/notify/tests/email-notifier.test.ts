import { expect, test } from "vite-plus/test";
import { createEmailNotifier, createEmailTransport } from "../src/index.ts";

function createTransportMock() {
  const calls: Array<Record<string, unknown>> = [];
  let closed = false;
  const gateway = {
    sendMail: async (data: Record<string, unknown>) => {
      calls.push(data);
      return {};
    },
    close: () => {
      closed = true;
    },
  };
  return { calls, isClosed: () => closed, createTransport: () => gateway };
}

function withEnv<T>(run: () => T): T {
  const prevUser = process.env.SERVER_EMAIL;
  const prevPass = process.env.SERVER_EMAIL_PASSWORD;
  process.env.SERVER_EMAIL = "bot@qq.com";
  process.env.SERVER_EMAIL_PASSWORD = "secret";
  try {
    return run();
  } finally {
    process.env.SERVER_EMAIL = prevUser;
    process.env.SERVER_EMAIL_PASSWORD = prevPass;
  }
}

test("发送通用消息到收件人", async () => {
  await withEnv(async () => {
    const { calls, createTransport } = createTransportMock();
    const notifier = createEmailNotifier(
      { address: "admin@qq.com", cc: ["cc@qq.com"] },
      { createTransport },
    );

    await notifier.send({
      subject: "测试",
      text: "这是测试正文",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      from: "bot@qq.com",
      to: "admin@qq.com",
      cc: ["cc@qq.com"],
      subject: "测试",
      text: "这是测试正文",
    });
  });
});

test("发送失败被吞掉，不向上抛", async () => {
  const createTransport = () => ({
    sendMail: async () => {
      throw new Error("network");
    },
    close: () => {},
  });
  const notifier = createEmailNotifier({ address: "admin@qq.com" }, { createTransport });

  await expect(notifier.send({ subject: "测试", text: "x" })).resolves.toBeUndefined();
});

test("close 会关闭底层的 SMTP 网关", async () => {
  const { isClosed, createTransport } = createTransportMock();
  const notifier = createEmailNotifier({ address: "admin@qq.com" }, { createTransport });

  await notifier.close?.();
  expect(isClosed()).toBe(true);
});

test("createEmailTransport 返回可用的 SMTP 传输器", () => {
  const transport = createEmailTransport({ address: "admin@qq.com" });
  expect(typeof transport.sendMail).toBe("function");
  expect(typeof transport.verify).toBe("function");
  expect(typeof transport.close).toBe("function");
});
