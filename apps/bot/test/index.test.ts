import "dotenv/config";
import { expect, test } from "vite-plus/test";

test("测试 .env 文件是否被正确加载", () => {
  expect(process.env.NC_WS_URL).toBeDefined();
  expect(process.env.NC_ACCESS_TOKEN).toBeDefined();
});
