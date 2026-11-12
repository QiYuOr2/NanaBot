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

const deployScript = fileURLToPath(new URL("../deploy-site-output.sh", import.meta.url));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nana-deploy-"));
  roots.push(root);
  const app = join(root, "apps/site");
  const bin = join(root, "bin");
  const artifact = join(root, "site-output.tar.gz");
  for (const folder of [app, bin, join(root, "artifact/server"), join(root, ".output/server")])
    mkdirSync(folder, { recursive: true });
  mkdirSync(join(app, ".output/server"), { recursive: true });
  writeFileSync(join(root, ".output/server/index.mjs"), "unrelated-root-output");
  writeFileSync(join(app, ".output/server/index.mjs"), "old");
  writeFileSync(join(root, "artifact/server/index.mjs"), "new");
  writeFileSync(
    join(app, "ecosystem.config.cjs"),
    `const path = require("node:path");
module.exports = { apps: [{
  name: "@nana/site",
  cwd: __dirname,
  script: path.join(__dirname, ".output/server/index.mjs"),
  env: { PORT: "6364" }
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
const countPath = path.join(root, "restarts");
const count = Number(fs.existsSync(countPath) ? fs.readFileSync(countPath, "utf8") : 0) + 1;
fs.writeFileSync(countPath, String(count));
if (process.env.TEST_FAIL_RESTART === "1" && count === 1) process.exit(1);
const config = require(path.resolve(process.argv[3]));
const app = config.apps.find(app => app.name === "@nana/site");
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
        SITE_HEALTH_URL: "",
        SITE_PM2_CONFIG: "",
        SITE_HEALTH_ATTEMPTS: "2",
        NITRO_PORT: "",
        PORT: "",
        TEST_DEPLOY_ROOT: root,
        TEST_HEALTH_URL: "http://127.0.0.1:6364/api/health",
        ...env,
      },
    });
  return { root, app, artifact, run };
}

test("部署到 PM2 实际启动目录并使用其端口，不改动仓库根的同名目录", () => {
  const { root, app, artifact, run } = fixture();
  // 脚本也可从仓库外调用，artifact 与 project-root 均显式传入。
  const result = run({}, tmpdir());
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(readFileSync(join(app, ".output/server/index.mjs"), "utf8")).toBe("new");
  expect(readFileSync(join(root, "active"), "utf8")).toBe("new");
  expect(readFileSync(join(root, ".output/server/index.mjs"), "utf8")).toBe(
    "unrelated-root-output",
  );
  expect(existsSync(artifact)).toBe(false);
  expect(readdirSync(app).filter((name) => name.startsWith(".output."))).toEqual([]);
});

test.each(["TEST_FAIL_HEALTH", "TEST_FAIL_RESTART"])("%s 时恢复 PM2 实际启动的旧产物", (key) => {
  const { root, app, artifact, run } = fixture();
  const result = run({ [key]: "1" });
  expect(result.status).toBe(1);
  expect(readFileSync(join(app, ".output/server/index.mjs"), "utf8")).toBe("old");
  expect(readFileSync(join(root, "active"), "utf8")).toBe("old");
  expect(readFileSync(join(root, "restarts"), "utf8")).toBe("2");
  expect(existsSync(artifact)).toBe(true);
  expect(readdirSync(app).filter((name) => name.startsWith(".output."))).toEqual([]);
});

test("支持显式覆盖健康检查 URL", () => {
  const { root, run } = fixture();
  const url = "http://127.0.0.1:7777/api/health";
  const result = run({ SITE_HEALTH_URL: url, TEST_HEALTH_URL: url });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(readFileSync(join(root, "health-url"), "utf8")).toBe(url);
});
