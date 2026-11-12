import { expect, test } from "vite-plus/test";
import { parseNvidiaStats, readSystemStatus } from "../server/utils/systemStatus.ts";
import { tmpdir } from "node:os";

test("解析多 GPU 指标，未支持的字段保留为空", () => {
  expect(
    parseNvidiaStats(
      "0, NVIDIA RTX 4090, 25, 1024, 24576, 55\n1, NVIDIA T4, [N/A], [N/A], 16384, [N/A]",
    ),
  ).toEqual([
    {
      index: 0,
      name: "NVIDIA RTX 4090",
      percent: 25,
      temperature: 55,
      memory: expect.objectContaining({ used: 1024 ** 3, total: 24576 * 1024 ** 2 }),
    },
    { index: 1, name: "NVIDIA T4", percent: null, temperature: null, memory: null },
  ]);
  expect(parseNvidiaStats("")).toEqual([]);
});

test("服务器快照包含 CPU、内存、磁盘，未安装 GPU 工具不影响其他状态", async () => {
  const result = await readSystemStatus(tmpdir());
  expect(result.cpu.cores).toBeGreaterThan(0);
  expect(result.cpu.percent).toBeGreaterThanOrEqual(0);
  expect(result.cpu.percent).toBeLessThanOrEqual(100);
  expect(result.memory.total).toBeGreaterThan(0);
  expect(result.disks.some((disk) => disk.usage && disk.usage.total > 0)).toBe(true);
  expect(result.generatedAt).toBeTruthy();
  if (!result.gpus.length) expect(result.gpuMessage).toBeTruthy();
});
