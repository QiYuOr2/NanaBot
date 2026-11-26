import { expect, test } from "vite-plus/test";
import { DANMU_CLOSE_REASON_LABELS, toDanmuSessionSummary } from "../shared/danmu.ts";

test("超管切断结束原因映射为中文标签，并透传切断次数", () => {
  expect(DANMU_CLOSE_REASON_LABELS.cut_off).toBe("超管切断");

  const summary = toDanmuSessionSummary(
    {
      id: 7,
      roomId: "4629447",
      streamer: "饭总",
      startedAt: "2026-10-01T10:00:00.000Z",
      endedAt: "2026-10-01T10:45:00.000Z",
      closeReason: "cut_off",
      msgCount: 120,
      participantCount: 45,
      cutOffCount: 1,
    },
    { ms: 45 * 60 * 1000, text: "45 分钟" },
  );

  expect(summary).toMatchObject({
    id: 7,
    roomId: 4629447,
    closeReason: "cut_off",
    closeReasonLabel: "超管切断",
    cutOffCount: 1,
    active: false,
  });
});
