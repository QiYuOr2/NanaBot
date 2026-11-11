import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATABASE_DIRECTORY, NANA_CONFIG_FILE } from "@nana/constants";
import { closeDanmuSession, openDanmuSession, readLiveSummary } from "@nana/storage";
import { appendDanmuMessages } from "@nana/storage";
import { describe, expect, test } from "vite-plus/test";
import {
  buildDanmuExcerpt,
  buildSummaryPrompt,
  normalizeSummaryText,
  renderLiveSummaryMessage,
  settleLiveSummary,
} from "../src/index.ts";

function createRootDir(): string {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-live-summary-"));
  writeFileSync(join(rootDir, NANA_CONFIG_FILE), "", "utf8");
  mkdirSync(join(rootDir, DATABASE_DIRECTORY));
  return rootDir;
}

describe("弹幕摘录与正文", () => {
  test("空白弹幕不会进入摘录", () => {
    expect(buildDanmuExcerpt([{ content: "  " }, { content: "" }])).toEqual({
      text: "",
      usableCount: 0,
      mode: "full",
    });
  });

  test("重复句会留下，超长正文截在句号", () => {
    const messages = [
      ...Array.from({ length: 5 }, () => ({ content: "好听" })),
      { content: `${"很".repeat(180)}。后面这句不该留下` },
    ];
    const excerpt = buildDanmuExcerpt(messages);
    expect(excerpt.usableCount).toBe(6);
    expect(excerpt.text).toContain("好听 ×5");

    const normalized = normalizeSummaryText(`摘要：${"很".repeat(80)}。${"后".repeat(160)}`);
    expect(Array.from(normalized).length).toBeLessThanOrEqual(200);
    expect(normalized.endsWith("。")).toBe(true);
    expect(normalized).not.toContain("不该留下");
    expect(renderLiveSummaryMessage("观众在聊歌")).toBe(
      "【直播摘要】根据弹幕推断，不是直播内容本身\n观众在聊歌",
    );
  });

  test("5000 条以内且正文未超限时使用完整弹幕", () => {
    const messages = Array.from({ length: 5000 }, (_, index) => ({
      content: `第${index}条弹幕`,
    }));
    const excerpt = buildDanmuExcerpt(messages);
    const transcript = excerpt.text.split("完整弹幕（按时间顺序）：\n")[1] ?? "";
    const included = transcript.match(/第\d+条弹幕/g) ?? [];

    expect(excerpt.mode).toBe("full");
    expect(included).toHaveLength(5000);
    expect(included[0]).toBe("第0条弹幕");
    expect(included[1234]).toBe("第1234条弹幕");
    expect(included.at(-1)).toBe("第4999条弹幕");
  });

  test("超过 5000 条时等距抽样覆盖全程", () => {
    const messages = Array.from({ length: 6000 }, (_, index) => ({
      content: `第${index}条弹幕`,
    }));
    const excerpt = buildDanmuExcerpt(messages);
    const sampled = [...excerpt.text.matchAll(/第(\d+)条弹幕/g)].map((match) => Number(match[1]));
    const buckets = [0, 0, 0];
    for (const index of sampled) {
      buckets[Math.floor(index / 2000)] += 1;
    }

    expect(excerpt.mode).toBe("sampled");
    expect(sampled[0]).toBe(0);
    expect(sampled.at(-1)).toBe(5999);
    expect(buckets.every((count) => count >= 30)).toBe(true);
  });

  test("超长弹幕仍受摘录字符上限约束", () => {
    const messages = Array.from({ length: 400 }, (_, index) => ({
      content: `第${index}条${"很".repeat(240)}`,
    }));
    const excerpt = buildDanmuExcerpt(messages);
    const sample = excerpt.text.split("全程抽样（覆盖开播到下播，相邻行不一定连续）：\n")[1] ?? "";

    expect(excerpt.mode).toBe("sampled");
    expect(sample.startsWith("第0条")).toBe(true);
    expect(sample.length).toBeLessThanOrEqual(7000);
  });

  test("提示词区分完整弹幕与抽样", () => {
    const common = { streamer: "饭总", messageCount: 5000, excerpt: "弹幕" };

    expect(buildSummaryPrompt({ ...common, fullTranscript: true }).system).toContain(
      "本场全部弹幕",
    );
    expect(buildSummaryPrompt({ ...common, fullTranscript: false }).system).toContain(
      "均匀抽取的样本",
    );
  });
});

describe("settleLiveSummary", () => {
  test("没有弹幕时写成 empty，页面来源不会要求发群", async () => {
    const rootDir = createRootDir();
    const session = openDanmuSession(
      { roomId: 1, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );
    closeDanmuSession(
      session.id,
      { endedAt: "2026-10-01T11:00:00.000Z", reason: "live.ended" },
      { rootDir },
    );

    const settled = await settleLiveSummary({
      sessionId: session.id,
      source: "site",
      apiKey: "test-key",
      rootDir,
      fetch: async () => {
        throw new Error("没有弹幕时不应该请求模型");
      },
    });

    expect(settled).toMatchObject({
      kind: "ready",
      status: "empty",
      shouldPush: false,
      text: null,
    });
    expect(readLiveSummary(session.id, { rootDir })).toMatchObject({
      status: "empty",
      source: "site",
    });
  });

  test("机器人生成成功后才标记应发群，再次调用直接复用正文", async () => {
    const rootDir = createRootDir();
    const session = openDanmuSession(
      { roomId: 1, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );
    appendDanmuMessages(
      session.id,
      [
        {
          sentAt: "2026-10-01T10:01:00.000Z",
          userId: "1",
          username: "观众",
          content: "这首歌好好听",
        },
      ],
      { rootDir },
    );
    closeDanmuSession(
      session.id,
      { endedAt: "2026-10-01T11:00:00.000Z", reason: "live.ended" },
      { rootDir },
    );

    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "观众一直在说这首歌很好听，讨论集中在旋律和现场。" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const first = await settleLiveSummary({
      sessionId: session.id,
      source: "bot",
      apiKey: "test-key",
      rootDir,
      fetch: fetchImpl,
    });
    const second = await settleLiveSummary({
      sessionId: session.id,
      source: "site",
      apiKey: "test-key",
      rootDir,
      fetch: fetchImpl,
    });

    expect(calls).toBe(1);
    expect(first).toMatchObject({
      kind: "ready",
      status: "ok",
      shouldPush: true,
      text: "观众一直在说这首歌很好听，讨论集中在旋律和现场。",
    });
    expect(second).toMatchObject({
      kind: "ready",
      status: "ok",
      shouldPush: false,
      text: first.kind === "ready" ? first.text : "",
    });
  });

  test("页面生成成功也不要求发群", async () => {
    const rootDir = createRootDir();
    const session = openDanmuSession(
      { roomId: 1, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );
    appendDanmuMessages(
      session.id,
      [
        {
          sentAt: "2026-10-01T10:01:00.000Z",
          userId: "1",
          username: "观众",
          content: "在看老视频",
        },
      ],
      { rootDir },
    );
    closeDanmuSession(
      session.id,
      { endedAt: "2026-10-01T11:00:00.000Z", reason: "live.ended" },
      { rootDir },
    );

    const settled = await settleLiveSummary({
      sessionId: session.id,
      source: "site",
      apiKey: "test-key",
      rootDir,
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "观众在看老视频，话题集中在以前的片段。" } }],
          }),
          {
            status: 200,
          },
        ),
    });

    expect(settled).toMatchObject({ kind: "ready", status: "ok", shouldPush: false });
    expect(readLiveSummary(session.id, { rootDir })?.source).toBe("site");
  });

  test("force 会重新调用模型并覆盖已有摘要", async () => {
    const rootDir = createRootDir();
    const session = openDanmuSession(
      { roomId: 1, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );
    appendDanmuMessages(
      session.id,
      [
        {
          sentAt: "2026-10-01T10:01:00.000Z",
          userId: "1",
          username: "观众",
          content: "今天在聊新歌",
        },
      ],
      { rootDir },
    );
    closeDanmuSession(
      session.id,
      { endedAt: "2026-10-01T11:00:00.000Z", reason: "live.ended" },
      { rootDir },
    );

    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: calls === 1 ? "第一版摘要。" : "第二版摘要。" } }],
        }),
        { status: 200 },
      );
    };

    await settleLiveSummary({
      sessionId: session.id,
      source: "site",
      apiKey: "test-key",
      rootDir,
      fetch: fetchImpl,
    });
    const regenerated = await settleLiveSummary({
      sessionId: session.id,
      source: "site",
      apiKey: "test-key",
      rootDir,
      force: true,
      fetch: fetchImpl,
    });

    expect(calls).toBe(2);
    expect(regenerated).toMatchObject({
      kind: "ready",
      status: "ok",
      shouldPush: false,
      text: "第二版摘要。",
    });
    expect(readLiveSummary(session.id, { rootDir })?.text).toBe("第二版摘要。");
  });
});
