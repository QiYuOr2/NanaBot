import { describe, expect, test } from "vite-plus/test";
import { renderSessionMessage, summarizeSession } from "../src/index.ts";
import type { DanmuMessageLike } from "../src/index.ts";

const STARTED_AT = "2026-08-22T10:00:00.000Z";
const ENDED_AT = "2026-08-22T11:30:00.000Z";

function message(userId: string, username: string, content: string): DanmuMessageLike {
  return { userId, username, content };
}

const MESSAGES: DanmuMessageLike[] = [
  message("1", "小明", "原神的剧情真棒"),
  message("2", "小红", "原神剧情真棒"),
  message("1", "小明", "原神好玩"),
  message("3", "阿强", "剧情太感人了"),
];

function buildSummary(messages: DanmuMessageLike[] = MESSAGES) {
  return summarizeSession({
    streamer: "娜娜",
    roomId: 12345,
    startedAt: STARTED_AT,
    endedAt: ENDED_AT,
    messages,
  });
}

describe("summarizeSession", () => {
  test("统计条数、参与人数与时长", () => {
    const summary = buildSummary();

    expect(summary.streamer).toBe("娜娜");
    expect(summary.roomId).toBe(12345);
    expect(summary.startedAt).toBe(STARTED_AT);
    expect(summary.endedAt).toBe(ENDED_AT);
    expect(summary.messageCount).toBe(4);
    expect(summary.participantCount).toBe(3);
    expect(summary.durationMs).toBe(90 * 60 * 1000);
    expect(summary.durationText).toBe("1 小时 30 分钟");
  });

  test("接受 Date 输入并统一输出 ISO 字符串", () => {
    const summary = summarizeSession({
      streamer: "娜娜",
      roomId: 1,
      startedAt: new Date(STARTED_AT),
      endedAt: new Date(ENDED_AT),
      messages: [],
    });

    expect(summary.startedAt).toBe(STARTED_AT);
    expect(summary.endedAt).toBe(ENDED_AT);
  });

  test("下播早于开播时时长按 0 处理", () => {
    const summary = summarizeSession({
      streamer: "娜娜",
      roomId: 1,
      startedAt: ENDED_AT,
      endedAt: STARTED_AT,
      messages: [],
    });

    expect(summary.durationMs).toBe(0);
    expect(summary.durationText).toBe("0 秒");
  });

  test("无法解析的时间直接抛错", () => {
    expect(() =>
      summarizeSession({
        streamer: "娜娜",
        roomId: 1,
        startedAt: "not-a-date",
        endedAt: ENDED_AT,
        messages: [],
      }),
    ).toThrow(/开播时间/u);
  });

  test("弹幕王按发言条数选出，平票时取先发言的人", () => {
    const summary = buildSummary([
      message("2", "小红", "原神好看"),
      message("1", "小明", "剧情不错"),
      message("2", "小红", "角色可爱"),
      message("2", "小红", "原神角色"),
    ]);

    expect(summary.topChater).toEqual({ userId: "2", username: "小红", count: 3 });
  });

  test("游客弹幕 uid 都是 0 时按昵称分别统计", () => {
    // 未登录的直播连接里 B 站把所有发送者 uid 置 0，只保留（可能打码的）昵称。
    const summary = buildSummary([
      message("0", "小明", "第一句"),
      message("0", "小红", "第二句"),
      message("0", "小明", "第三句"),
      message("0", "阿强", "第四句"),
    ]);

    expect(summary.participantCount).toBe(3);
    expect(summary.topChater).toEqual({ userId: "0", username: "小明", count: 2 });
  });

  test("有真实 uid 的弹幕仍按用户合并，不因改昵称拆成两人", () => {
    const summary = buildSummary([
      message("7", "旧昵称", "第一句"),
      message("7", "新昵称", "第二句"),
    ]);

    expect(summary.participantCount).toBe(1);
    expect(summary.topChater).toEqual({ userId: "7", username: "新昵称", count: 2 });
  });

  test("最高频单条弹幕按内容统计，不区分发言者", () => {
    const summary = buildSummary([
      message("1", "小明", "好耶"),
      message("2", "小红", "好耶 "),
      message("3", "阿强", "好耶"),
      message("1", "小明", "原神好玩"),
    ]);

    expect(summary.topRepeated).toEqual({ content: "好耶", count: 3 });
  });

  test("纯 emoji 弹幕不参与最高频单条评选", () => {
    const summary = buildSummary([
      message("1", "小明", "😂😂😂"),
      message("2", "小红", "😂😂😂"),
      message("3", "阿强", "剧情很棒"),
    ]);

    expect(summary.topRepeated).toEqual({ content: "剧情很棒", count: 1 });
  });

  test("Top 词默认取 10 条，可通过 options 调整", () => {
    const summary = buildSummary();

    expect(summary.topWords.length).toBeGreaterThan(0);
    expect(summary.topWords.length).toBeLessThanOrEqual(10);
    expect(buildSummary().topWords.every((item) => item.count >= 1)).toBe(true);
  });

  test("空弹幕场次返回完整结构", () => {
    const summary = buildSummary([]);

    expect(summary.messageCount).toBe(0);
    expect(summary.participantCount).toBe(0);
    expect(summary.topWords).toEqual([]);
    expect(summary.topChater).toBeNull();
    expect(summary.topRepeated).toBeNull();
  });

  test("同一输入统计结果完全一致", () => {
    expect(buildSummary()).toEqual(buildSummary());
  });
});

describe("renderSessionMessage", () => {
  test("文案包含主播、时长、条数、人数、Top 词、弹幕王与最高频弹幕", () => {
    const { subject, text } = renderSessionMessage(buildSummary());

    expect(subject).toBe("「NanaBot」娜娜 本场弹幕词云");
    expect(text).toContain("主播: 娜娜");
    expect(text).toContain("时长: 1 小时 30 分钟");
    expect(text).toContain("弹幕数: 4");
    expect(text).toContain("参与人数: 3");
    expect(text).toContain("Top 词:");
    expect(text).toContain("原神");
    expect(text).toContain("弹幕王: 小明（2 条）");
    expect(text).toContain("最高频弹幕:");
  });

  test("本场没有弹幕时给出说明文案", () => {
    const { subject, text } = renderSessionMessage(buildSummary([]));

    expect(subject).toContain("娜娜");
    expect(text).toContain("本场没有记录到弹幕");
    expect(text).not.toContain("Top 词");
  });

  test("标题与 Top 词数量可配置", () => {
    const { subject, text } = renderSessionMessage(buildSummary(), {
      title: "直播总结",
      topWords: 1,
    });
    const topWordLine = text.split("\n").find((line) => line.startsWith("Top 词:"));

    expect(subject).toBe("「NanaBot」娜娜 本场直播总结");
    expect(topWordLine).toBeDefined();
    expect(topWordLine?.includes("、")).toBe(false);
  });

  test("过长的弹幕在文案中被截断", () => {
    const longContent = "很".repeat(100);
    const { text } = renderSessionMessage(buildSummary([message("1", "小明", longContent)]));

    expect(text).toContain("…");
    expect(text).not.toContain(longContent);
  });
});
