import { expect, test, vi } from "vite-plus/test";
import { qrConnect } from "@tencent-connect/qqbot-connector";
import { connectQQRobot } from "../src/connect.ts";

vi.mock("@tencent-connect/qqbot-connector", () => ({ qrConnect: vi.fn() }));

test("扫码包装保留取消信号与多机器人凭据，不选择保存位置", async () => {
  const controller = new AbortController();
  const credentials = [
    { appId: "app1", appSecret: "secret1" },
    { appId: "app2", appSecret: "secret2" },
  ];
  vi.mocked(qrConnect).mockResolvedValue(credentials);
  await expect(connectQQRobot({ signal: controller.signal })).resolves.toEqual(credentials);
  expect(qrConnect).toHaveBeenCalledWith({ signal: controller.signal });
});
