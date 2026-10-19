import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { DANMU_FILE, DATABASE_DIRECTORY } from "@nana/constants";
import {
  appendDanmuMessages,
  closeDanmuSession,
  findActiveDanmuSession,
  listDanmuSessions,
  openDanmuSession,
  readDanmuMessages,
  readDanmuSession,
} from "../src/index.ts";
import { createRootDir } from "./setup.ts";

const ROOM_ID = 4629447;

function message(content: string, sentAt: string, userId = "1001", username = "饭友甲") {
  return { sentAt, userId, username, content };
}

describe("openDanmuSession / findActiveDanmuSession", () => {
  test("开启场次后能查到进行中的场次", () => {
    const rootDir = createRootDir();

    const session = openDanmuSession(
      { roomId: ROOM_ID, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );

    expect(session.id).toBeGreaterThan(0);
    expect(session).toMatchObject({
      roomId: String(ROOM_ID),
      streamer: "饭总",
      startedAt: "2026-10-01T10:00:00.000Z",
      endedAt: null,
      closeReason: null,
      msgCount: 0,
    });
    expect(existsSync(join(rootDir, DATABASE_DIRECTORY, DANMU_FILE))).toBe(true);

    expect(findActiveDanmuSession(ROOM_ID, { rootDir })).toEqual(session);
    expect(readDanmuSession(session.id, { rootDir })).toEqual(session);
  });

  test("开新场时把残留场次标记为 stale 关闭", () => {
    const rootDir = createRootDir();

    const stale = openDanmuSession(
      { roomId: ROOM_ID, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );
    const current = openDanmuSession(
      { roomId: ROOM_ID, streamer: "饭总", startedAt: "2026-10-02T10:00:00.000Z" },
      { rootDir },
    );

    expect(current.id).not.toBe(stale.id);
    expect(readDanmuSession(stale.id, { rootDir })).toMatchObject({
      endedAt: "2026-10-02T10:00:00.000Z",
      closeReason: "stale",
    });
    expect(findActiveDanmuSession(ROOM_ID, { rootDir })?.id).toBe(current.id);
  });

  test("残留场次清理只影响同一直播间", () => {
    const rootDir = createRootDir();

    const otherRoom = openDanmuSession(
      { roomId: 10086, streamer: "另一主播", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );
    openDanmuSession(
      { roomId: ROOM_ID, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );
    openDanmuSession(
      { roomId: ROOM_ID, streamer: "饭总", startedAt: "2026-10-02T10:00:00.000Z" },
      { rootDir },
    );

    expect(readDanmuSession(otherRoom.id, { rootDir })?.endedAt).toBeNull();
  });

  test("没有进行中的场次时 findActiveDanmuSession 返回 undefined", () => {
    const rootDir = createRootDir();

    const session = openDanmuSession(
      { roomId: ROOM_ID, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );
    closeDanmuSession(
      session.id,
      { endedAt: "2026-10-01T12:00:00.000Z", reason: "live.ended" },
      { rootDir },
    );

    expect(findActiveDanmuSession(ROOM_ID, { rootDir })).toBeUndefined();
    expect(findActiveDanmuSession(10086, { rootDir })).toBeUndefined();
  });
});

describe("appendDanmuMessages / readDanmuMessages", () => {
  test("批量追加后 msg_count 累加，按发送顺序读取", () => {
    const rootDir = createRootDir();

    const session = openDanmuSession(
      { roomId: ROOM_ID, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );

    appendDanmuMessages(
      session.id,
      [
        message("第一句", "2026-10-01T10:00:01.000Z", "1001", "甲"),
        message("第二句", "2026-10-01T10:00:02.000Z", "1002", "乙"),
      ],
      { rootDir },
    );
    appendDanmuMessages(session.id, [message("第三句", "2026-10-01T10:00:03.000Z")], {
      rootDir,
    });

    expect(readDanmuSession(session.id, { rootDir })?.msgCount).toBe(3);

    const messages = readDanmuMessages(session.id, { rootDir });
    expect(messages.map((item) => item.content)).toEqual(["第一句", "第二句", "第三句"]);
    expect(messages[0]).toMatchObject({
      sessionId: session.id,
      userId: "1001",
      username: "甲",
      sentAt: "2026-10-01T10:00:01.000Z",
    });
    expect(messages.every((item) => item.id > 0)).toBe(true);
  });

  test("按发送时间排序，与写入先后无关", () => {
    const rootDir = createRootDir();

    const session = openDanmuSession(
      { roomId: ROOM_ID, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );

    appendDanmuMessages(
      session.id,
      [
        message("晚的", "2026-10-01T10:00:09.000Z"),
        message("早的", "2026-10-01T10:00:01.000Z"),
        message("中间的", "2026-10-01T10:00:05.000Z"),
      ],
      { rootDir },
    );

    expect(readDanmuMessages(session.id, { rootDir }).map((item) => item.content)).toEqual([
      "早的",
      "中间的",
      "晚的",
    ]);
  });

  test("空数组不写库也不报错", () => {
    const rootDir = createRootDir();

    const session = openDanmuSession(
      { roomId: ROOM_ID, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );

    expect(() => appendDanmuMessages(session.id, [], { rootDir })).not.toThrow();
    expect(readDanmuSession(session.id, { rootDir })?.msgCount).toBe(0);
    expect(readDanmuMessages(session.id, { rootDir })).toEqual([]);
  });

  test("不同场次的弹幕互不干扰", () => {
    const rootDir = createRootDir();

    const first = openDanmuSession(
      { roomId: ROOM_ID, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );
    appendDanmuMessages(first.id, [message("旧场弹幕", "2026-10-01T10:00:01.000Z")], {
      rootDir,
    });

    const second = openDanmuSession(
      { roomId: ROOM_ID, streamer: "饭总", startedAt: "2026-10-02T10:00:00.000Z" },
      { rootDir },
    );

    expect(readDanmuMessages(first.id, { rootDir })).toHaveLength(1);
    expect(readDanmuMessages(second.id, { rootDir })).toEqual([]);
    expect(readDanmuSession(second.id, { rootDir })?.msgCount).toBe(0);
  });
});

describe("closeDanmuSession", () => {
  test("写入结束时间与原因，并幂等", () => {
    const rootDir = createRootDir();

    const session = openDanmuSession(
      { roomId: ROOM_ID, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );

    const closed = closeDanmuSession(
      session.id,
      { endedAt: "2026-10-01T12:00:00.000Z", reason: "live.ended" },
      { rootDir },
    );
    expect(closed).toMatchObject({
      id: session.id,
      endedAt: "2026-10-01T12:00:00.000Z",
      closeReason: "live.ended",
    });

    const again = closeDanmuSession(
      session.id,
      { endedAt: "2026-10-01T13:00:00.000Z", reason: "poll" },
      { rootDir },
    );
    expect(again).toMatchObject({
      endedAt: "2026-10-01T12:00:00.000Z",
      closeReason: "live.ended",
    });
  });

  test("场次不存在时返回 undefined", () => {
    const rootDir = createRootDir();

    expect(
      closeDanmuSession(
        999,
        { endedAt: "2026-10-01T12:00:00.000Z", reason: "shutdown" },
        {
          rootDir,
        },
      ),
    ).toBeUndefined();
  });
});

describe("listDanmuSessions", () => {
  test("按开始时间倒序并限制条数，带参与人数", () => {
    const rootDir = createRootDir();

    const sessions = ["10:00", "11:00", "12:00"].map((time) =>
      openDanmuSession(
        { roomId: ROOM_ID, streamer: "饭总", startedAt: `2026-10-01T${time}:00.000Z` },
        { rootDir },
      ),
    );

    appendDanmuMessages(
      sessions[1].id,
      [
        message("一", "2026-10-01T11:00:01.000Z", "1001"),
        message("二", "2026-10-01T11:00:02.000Z", "1002"),
        message("三", "2026-10-01T11:00:03.000Z", "1001"),
      ],
      { rootDir },
    );

    const list = listDanmuSessions({ rootDir });
    expect(list.map((item) => item.startedAt)).toEqual([
      "2026-10-01T12:00:00.000Z",
      "2026-10-01T11:00:00.000Z",
      "2026-10-01T10:00:00.000Z",
    ]);
    expect(list[1]).toMatchObject({ id: sessions[1].id, msgCount: 3, participantCount: 2 });

    const limited = listDanmuSessions({ rootDir }, 2);
    expect(limited).toHaveLength(2);
    expect(limited[0].startedAt).toBe("2026-10-01T12:00:00.000Z");
  });

  test("空数据库返回空数组", () => {
    const rootDir = createRootDir();
    expect(listDanmuSessions({ rootDir })).toEqual([]);
  });
});
