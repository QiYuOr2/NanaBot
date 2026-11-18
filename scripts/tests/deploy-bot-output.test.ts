import { afterEach, expect, test } from "vite-plus/test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const deployScript = fileURLToPath(new URL("../deploy-bot-output.sh", import.meta.url));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nana-bot-deploy-"));
  roots.push(root);
  const app = join(root, "apps/bot");
  const bin = join(root, "bin");
  const artifact = join(root, "bot-output.tar.gz");
  for (const folder of [
    bin,
    join(root, "dist"),
    join(app, "dist"),
    join(app, "node_modules"),
    join(root, "artifact/dist"),
    join(root, "artifact/node_modules/@node-rs/jieba"),
  ])
    mkdirSync(folder, { recursive: true });
  writeFileSync(join(root, "dist/index.mjs"), "unrelated-root-output");
  writeFileSync(join(app, "dist/index.mjs"), "old");
  writeFileSync(join(app, "node_modules/keep.txt"), "old-modules");
  writeFileSync(join(app, ".env"), "NANA_BOT_CONTROL_PORT=6365\n");
  writeFileSync(join(root, "artifact/dist/index.mjs"), "new");
  writeFileSync(join(root, "artifact/node_modules/@node-rs/jieba/index.txt"), "native");
  writeFileSync(
    join(app, "ecosystem.config.cjs"),
    `const path = require("node:path");
module.exports = { apps: [{
  name: "@nana/bot",
  cwd: __dirname,
  script: path.join(__dirname, "dist/index.mjs"),
  env: { NODE_ENV: "production" }
}] };`,
  );
  const packed = spawnSync("tar", ["-czf", artifact, "-C", join(root, "artifact"), "."]);
  if (packed.status !== 0) throw new Error(packed.stderr.toString());
  writeFileSync(
    join(bin, "pm2"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.TEST_DEPLOY_ROOT;
if (process.argv[2] === "logs") { console.log("stub pm2 log line"); process.exit(0); }
const countPath = path.join(root, "restarts");
const count = Number(fs.existsSync(countPath) ? fs.readFileSync(countPath, "utf8") : 0) + 1;
fs.writeFileSync(countPath, String(count));
if (process.env.TEST_FAIL_RESTART === "1" && count === 1) process.exit(1);
fs.writeFileSync(path.join(root, "marker-at-restart"), fs.existsSync(path.join(root, ".deploying.json")) ? "yes" : "no");
const config = require(path.resolve(process.argv[3]));
const app = config.apps.find(app => app.name === "@nana/bot");
const entry = path.resolve(app.cwd, app.script);
fs.writeFileSync(path.join(root, "active"), fs.readFileSync(entry, "utf8"));
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "curl"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.TEST_DEPLOY_ROOT;
const active = fs.readFileSync(path.join(root, "active"), "utf8");
const url = process.argv.at(-1);
fs.writeFileSync(path.join(root, "health-url"), url);
process.exit(process.env.TEST_FAIL_HEALTH === "1" || active !== "new" || url !== process.env.TEST_HEALTH_URL ? 1 : 0);
`,
    { mode: 0o755 },
  );
  writeFileSync(join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const run = (env: Record<string, string> = {}, cwd = root) =>
    spawnSync("bash", [deployScript, artifact, root], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        BOT_HEALTH_URL: "",
        BOT_PM2_CONFIG: "",
        BOT_HEALTH_ATTEMPTS: "2",
        TEST_DEPLOY_ROOT: root,
        TEST_HEALTH_URL: "http://127.0.0.1:6365/health",
        ...env,
      },
    });
  return { root, app, artifact, run };
}

function leftovers(app: string) {
  return readdirSync(app).filter(
    (name) =>
      name.startsWith(".bot-output.") ||
      name.startsWith("dist.") ||
      name.startsWith("node_modules."),
  );
}

test("只替换 PM2 实际启动的 dist 与 node_modules，不动 .env 与仓库根目录", () => {
  const { root, app, artifact, run } = fixture();
  // 脚本也可从仓库外调用，artifact 与 project-root 均显式传入。
  const result = run({}, tmpdir());
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(readFileSync(join(app, "dist/index.mjs"), "utf8")).toBe("new");
  expect(existsSync(join(app, "node_modules/@node-rs/jieba/index.txt"))).toBe(true);
  expect(readFileSync(join(app, ".env"), "utf8")).toBe("NANA_BOT_CONTROL_PORT=6365\n");
  expect(readFileSync(join(root, "active"), "utf8")).toBe("new");
  expect(readFileSync(join(root, "dist/index.mjs"), "utf8")).toBe("unrelated-root-output");
  expect(existsSync(artifact)).toBe(false);
  expect(leftovers(app)).toEqual([]);
  // 重启发生时部署标记必须已经就位；脚本结束后标记被清掉。
  expect(readFileSync(join(root, "marker-at-restart"), "utf8")).toBe("yes");
  expect(existsSync(join(root, ".deploying.json"))).toBe(false);
});

test.each(["TEST_FAIL_HEALTH", "TEST_FAIL_RESTART"])("%s 时恢复旧 dist 与 node_modules", (key) => {
  const { root, app, artifact, run } = fixture();
  const result = run({ [key]: "1" });
  expect(result.status).toBe(1);
  expect(readFileSync(join(app, "dist/index.mjs"), "utf8")).toBe("old");
  expect(readFileSync(join(app, "node_modules/keep.txt"), "utf8")).toBe("old-modules");
  expect(readFileSync(join(root, "active"), "utf8")).toBe("old");
  expect(readFileSync(join(root, "restarts"), "utf8")).toBe("2");
  expect(existsSync(artifact)).toBe(true);
  expect(leftovers(app)).toEqual([]);
  expect(existsSync(join(root, ".deploying.json"))).toBe(false);
});

test("支持显式覆盖健康检查 URL", () => {
  const { root, run } = fixture();
  const url = "http://127.0.0.1:7777/health";
  const result = run({ BOT_HEALTH_URL: url, TEST_HEALTH_URL: url });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(readFileSync(join(root, "health-url"), "utf8")).toBe(url);
});
