import { describe, expect, test } from "vite-plus/test";
import {
  appendDanmuMessages,
  claimLiveSummary,
  closeDanmuSession,
  completeLiveSummary,
  listUnpushedLiveSummaries,
  markLiveSummaryPushed,
  openDanmuSession,
  readLiveSummary,
} from "../src/index.ts";
import { createRootDir } from "./setup.ts";

const ROOM_ID = 4629447;

function endedSession(rootDir: string): number {
  const session = openDanmuSession(
    { roomId: ROOM_ID, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
    { rootDir },
  );
  appendDanmuMessages(
    session.id,
    [
      {
        sentAt: "2026-10-01T10:01:00.000Z",
        userId: "1",
        username: "观众",
        content: "今天在聊什么",
      },
    ],
    { rootDir },
  );
  closeDanmuSession(
    session.id,
    { endedAt: "2026-10-01T12:00:00.000Z", reason: "live.ended" },
    { rootDir },
  );
  return session.id;
}

describe("直播摘要认领", () => {
  test("进行中的场次不能认领", () => {
    const rootDir = createRootDir();
    const session = openDanmuSession(
      { roomId: ROOM_ID, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );

    expect(claimLiveSummary(session.id, { rootDir }).kind).toBe("active");
  });

  test("同一场只有一个调用能认领，完成后再次认领会读到已有正文", () => {
    const rootDir = createRootDir();
    const sessionId = endedSession(rootDir);
    const now = new Date("2026-10-01T12:05:00.000Z");

    const first = claimLiveSummary(sessionId, { rootDir, now });
    const second = claimLiveSummary(sessionId, { rootDir, now });

    expect(first).toEqual({ kind: "claimed", claimedAt: now.toISOString() });
    expect(second.kind).toBe("busy");
    expect(
      completeLiveSummary(
        sessionId,
        "not-the-claim",
        { status: "ok", text: "旧正文", source: "site" },
        { rootDir },
      ),
    ).toBe(false);

    expect(
      completeLiveSummary(
        sessionId,
        now.toISOString(),
        { status: "ok", text: "根据弹幕，观众在聊今天的话题。", source: "bot" },
        { rootDir },
      ),
    ).toBe(true);

    expect(claimLiveSummary(sessionId, { rootDir, now }).kind).toBe("existing");
    expect(readLiveSummary(sessionId, { rootDir })).toMatchObject({
      status: "ok",
      text: "根据弹幕，观众在聊今天的话题。",
      source: "bot",
      pushed: false,
      ended: true,
    });
  });

  test("过期的 pending 可以被重新认领", () => {
    const rootDir = createRootDir();
    const sessionId = endedSession(rootDir);
    const firstAt = new Date("2026-10-01T12:05:00.000Z");
    const laterAt = new Date("2026-10-01T12:08:00.000Z");

    expect(claimLiveSummary(sessionId, { rootDir, now: firstAt }).kind).toBe("claimed");
    const reclaimed = claimLiveSummary(sessionId, { rootDir, now: laterAt });

    expect(reclaimed).toEqual({ kind: "claimed", claimedAt: laterAt.toISOString() });
    expect(
      completeLiveSummary(
        sessionId,
        firstAt.toISOString(),
        { status: "ok", text: "迟到的正文", source: "bot" },
        { rootDir },
      ),
    ).toBe(false);
  });

  test("force 可以覆盖已有摘要，但不会抢占正在生成的摘要", () => {
    const rootDir = createRootDir();
    const sessionId = endedSession(rootDir);
    const firstAt = new Date("2026-10-01T12:05:00.000Z");

    const first = claimLiveSummary(sessionId, { rootDir, now: firstAt });
    if (first.kind !== "claimed") {
      throw new Error("首次认领失败");
    }
    completeLiveSummary(
      sessionId,
      first.claimedAt,
      { status: "ok", text: "旧摘要", source: "site" },
      { rootDir },
    );

    expect(claimLiveSummary(sessionId, { rootDir }).kind).toBe("existing");

    const secondAt = new Date("2026-10-01T12:10:00.000Z");
    const forced = claimLiveSummary(sessionId, { rootDir, now: secondAt, force: true });
    expect(forced).toEqual({ kind: "claimed", claimedAt: secondAt.toISOString() });
    expect(claimLiveSummary(sessionId, { rootDir, now: secondAt, force: true }).kind).toBe("busy");

    expect(
      completeLiveSummary(
        sessionId,
        secondAt.toISOString(),
        { status: "ok", text: "新摘要", source: "site" },
        { rootDir },
      ),
    ).toBe(true);
    expect(readLiveSummary(sessionId, { rootDir })).toMatchObject({
      status: "ok",
      text: "新摘要",
      source: "site",
    });
  });

  test("只有机器人写好且未推送的摘要会被列出来", () => {
    const rootDir = createRootDir();
    const botSession = endedSession(rootDir);
    const siteSession = openDanmuSession(
      { roomId: 10086, streamer: "另一位", startedAt: "2026-10-02T10:00:00.000Z" },
      { rootDir },
    );
    closeDanmuSession(
      siteSession.id,
      { endedAt: "2026-10-02T11:00:00.000Z", reason: "live.ended" },
      { rootDir },
    );

    const botClaim = claimLiveSummary(botSession, { rootDir });
    const siteClaim = claimLiveSummary(siteSession.id, { rootDir });
    if (botClaim.kind !== "claimed" || siteClaim.kind !== "claimed") {
      throw new Error("测试场次未能认领");
    }

    completeLiveSummary(
      botSession,
      botClaim.claimedAt,
      { status: "ok", text: "机器人这份", source: "bot" },
      { rootDir },
    );
    completeLiveSummary(
      siteSession.id,
      siteClaim.claimedAt,
      { status: "ok", text: "页面这份", source: "site" },
      { rootDir },
    );

    expect(listUnpushedLiveSummaries({ rootDir })).toEqual([
      {
        id: botSession,
        roomId: String(ROOM_ID),
        streamer: "饭总",
        text: "机器人这份",
      },
    ]);

    markLiveSummaryPushed(botSession, { rootDir });
    expect(listUnpushedLiveSummaries({ rootDir })).toEqual([]);
    expect(readLiveSummary(siteSession.id, { rootDir })?.pushed).toBe(false);
  });
});
