import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { readProjectLogs } from "../server/utils/projectLogs.ts";

test("读取账号与轮转日志末尾，限制行数、字节并拒绝越界与符号链接", async () => {
  const root = mkdtempSync(join(tmpdir(), "nana-logs-"));
  try {
    expect((await readProjectLogs(undefined, 500, root)).files).toEqual([]);
    mkdirSync(join(root, "logs/accounts"), { recursive: true });
    writeFileSync(join(root, "logs/bot.log"), "first\nsecond\nthird\n");
    writeFileSync(join(root, "logs/accounts/main.log.1"), "rotated\n");
    writeFileSync(join(root, "logs/large.log"), "中文日志\n".repeat(80_000));
    writeFileSync(join(root, "secret.log"), "do not expose");
    symlinkSync(join(root, "secret.log"), join(root, "logs/link.log"));
    symlinkSync(root, join(root, "logs/linked-directory"));
    const view = await readProjectLogs("bot.log", 2, root);
    expect(view.content).toBe("second\nthird");
    expect(view.truncated).toBe(true);
    expect(view.files.map((file) => file.name).sort()).toEqual([
      "accounts/main.log.1",
      "bot.log",
      "large.log",
    ]);
    expect((await readProjectLogs("accounts/main.log.1", 10, root)).content).toBe("rotated");
    for (const name of [
      "../secret.log",
      "/etc/passwd",
      "link.log",
      "linked-directory/secret.log",
    ]) {
      await expect(readProjectLogs(name, 10, root)).rejects.toMatchObject({ statusCode: 400 });
    }
    const large = await readProjectLogs("large.log", 2000, root);
    expect(large.truncated).toBe(true);
    expect(Buffer.byteLength(large.content)).toBeLessThanOrEqual(256 * 1024);
    expect(large.content).not.toContain("\uFFFD");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
