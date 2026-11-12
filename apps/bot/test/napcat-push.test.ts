import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPushLogs } from "@nana/storage";
import { DATABASE_DIRECTORY, NANA_CONFIG_FILE } from "@nana/constants";
import { expect, test } from "vite-plus/test";
import { NapcatPushClient } from "../src/core/napcat.ts";

function createRootDir(): string {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-bot-push-"));
  writeFileSync(join(rootDir, NANA_CONFIG_FILE), "", "utf8");
  mkdirSync(join(rootDir, DATABASE_DIRECTORY));
  return rootDir;
}

interface FakeWs {
  getGroupInfo: (groupId: string) => Promise<{
    groupId: string;
    groupName: string;
  }>;
  sendGroupMessage: (
    groupId: string,
    message: unknown[],
  ) => Promise<{
    message_id: number;
  }>;
}

function createFakeWs(overrides: Partial<FakeWs> = {}): FakeWs {
  return {
    async getGroupInfo(groupId) {
      return { groupId, groupName: "饭友群" };
    },
    async sendGroupMessage() {
      return { message_id: 1 };
    },
    ...overrides,
  };
}

test("成功发送会解析群昵称并写入成功记录", async () => {
  const rootDir = createRootDir();
  const client = new NapcatPushClient(createFakeWs() as never, { rootDir, account: "main" });

  const target = await client.sendGroupMsg(
    1101365727,
    { purpose: "live.start", content: "饭总播了", subject: "饭总" },
    [],
  );

  expect(target).toBe("饭友群");
  expect(readPushLogs({ rootDir })).toEqual([
    expect.objectContaining({
      account: "main",
      targetId: "1101365727",
      target: "饭友群",
      purpose: "live.start",
      purposeLabel: "开播",
      success: true,
      content: "饭总播了",
      subject: "饭总",
    }),
  ]);
});

test("发送失败会记录失败并重新抛出错误", async () => {
  const rootDir = createRootDir();
  const error = new Error("ws 未连接");
  const client = new NapcatPushClient(
    createFakeWs({
      async sendGroupMessage() {
        throw error;
      },
    }) as never,
    { rootDir },
  );

  await expect(client.sendGroupMsg(123, { purpose: "app.offline" }, [])).rejects.toThrow(
    "ws 未连接",
  );

  expect(readPushLogs({ rootDir })).toEqual([
    expect.objectContaining({
      targetId: "123",
      target: "饭友群",
      purpose: "app.offline",
      purposeLabel: "下线",
      success: false,
      error: "ws 未连接",
    }),
  ]);
});

test("get_group_info 失败时回退到「群+ID」但仍记录", async () => {
  const rootDir = createRootDir();
  const client = new NapcatPushClient(
    createFakeWs({
      async getGroupInfo() {
        throw new Error("network");
      },
    }) as never,
    { rootDir },
  );

  await client.sendGroupMsg(456, { purpose: "notification" }, []);

  expect(readPushLogs({ rootDir })).toEqual([
    expect.objectContaining({
      targetId: "456",
      target: "群456",
      success: true,
    }),
  ]);
});

test("群昵称解析超时不会阻塞消息发送", async () => {
  const rootDir = createRootDir();
  let sent = false;
  const client = new NapcatPushClient(
    createFakeWs({
      async getGroupInfo() {
        return new Promise(() => {});
      },
      async sendGroupMessage() {
        sent = true;
        return { message_id: 1 };
      },
    }) as never,
    { rootDir, groupNameTimeoutMs: 10 },
  );

  const target = await client.sendGroupMsg(646247690, { purpose: "app.online" }, []);

  expect(sent).toBe(true);
  expect(target).toBe("群646247690");
  expect(readPushLogs({ rootDir })).toEqual([
    expect.objectContaining({
      targetId: "646247690",
      target: "群646247690",
      purpose: "app.online",
      success: true,
    }),
  ]);
});
