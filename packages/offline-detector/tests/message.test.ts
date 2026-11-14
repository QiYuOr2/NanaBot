import { expect, test } from "vite-plus/test";
import { renderOfflineAlert } from "../src/index.ts";

const deployment = { startedAt: "2026-11-14T11:00:00.000Z", ref: "abc1234" };

test("部署窗口内的离线告警明确标注为部署中", () => {
  const message = renderOfflineAlert(
    { kind: "offline", offlineSince: "2026-11-14T11:00:05.000Z", reason: "socket.close" },
    { deployment },
  );
  expect(message.subject).toBe("「NanaBot」部署中通知");
  expect(message.text).toContain("计划内重启");
  expect(message.text).toContain("部署版本: abc1234");
});

test("部署窗口内的恢复告警明确标注为部署完成", () => {
  const message = renderOfflineAlert(
    { kind: "recovered", offlineSince: "2026-11-14T11:00:05.000Z", downtimeMs: 42_000 },
    { deployment },
  );
  expect(message.subject).toBe("「NanaBot」部署完成通知");
  expect(message.text).toContain("部署更新已完成");
});

test("没有部署上下文时维持原来的离线/恢复措辞", () => {
  expect(
    renderOfflineAlert({ kind: "offline", offlineSince: "2026-11-14T11:00:05.000Z" }).subject,
  ).toBe("「NanaBot」离线通知");
  expect(
    renderOfflineAlert({ kind: "recovered", offlineSince: "2026-11-14T11:00:05.000Z" }).subject,
  ).toBe("「NanaBot」恢复通知");
});
