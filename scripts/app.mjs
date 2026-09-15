#!/usr/bin/env node
/**
 * 应用级构建 / PM2 管理入口：应用名从命令行传入，不把应用写死在 package.json 里。
 *
 * 应用从 `apps/<name>` 自动发现（构建任务用 package.json 的 name 推导，
 * PM2 进程名与配置取自该应用自己的 ecosystem.config.cjs），
 * 因此以后新增应用只需要建好目录，无需再往 package.json 加脚本。
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appsDir = path.join(rootDir, "apps");
const isWindows = process.platform === "win32";
const require = createRequire(import.meta.url);

const USAGE = `用法：pnpm app <命令> [应用名...] [选项]

命令：
  list                        列出可管理的应用
  build <应用...|all>         只构建（vp run <包名>#build）
  deploy <应用...|all>        构建 + pm2 startOrRestart（默认 all）
  start <应用...|all>         pm2 start（首次启动 / delete 之后重新拉起）
  restart <应用...|all>       pm2 restart（不重新构建）
  stop <应用...|all>          pm2 stop
  delete <应用...|all>        pm2 delete
  logs <应用...|all>          pm2 logs（跟随输出，通过 -- 透传参数）

选项：
  --no-build   deploy 时跳过构建，只做 PM2 重启
  --dry-run    只打印将要执行的命令，不真正执行
  -h, --help   打印本帮助

应用名可写目录名（bot）、包名（@nana/bot）或 apps/ 路径（apps/bot）。
all 表示 apps/ 下所有带 ecosystem.config.cjs 的可部署应用；没有该文件的目录
（例如只做构建的工具）不会被 all 带上，需要时用应用名显式指定。

示例：
  pnpm app list
  pnpm app deploy bot          # 只构建并重启 bot
  pnpm app deploy site
  pnpm app restart site        # 跳过构建，只重启
  pnpm app logs bot -- --lines 50
  pnpm app deploy all          # 所有可部署应用（当前即 bot + site）`;

let dryRun = false;

function fail(message) {
  console.error(`[app] ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[app] ${message}`);
}

function shellQuote(argument) {
  return /^[A-Za-z0-9_@%+=:,./#-]+$/.test(argument)
    ? argument
    : `"${argument.replaceAll('"', '\\"')}"`;
}

/** 统一用相对仓库根的路径调用，日志更短；子进程 cwd 固定为仓库根。 */
function toRelative(target) {
  const relative = path.relative(rootDir, target);
  return relative === "" || relative.startsWith("..") ? target : relative;
}

function run(command, args) {
  log(`$ ${[command, ...args].join(" ")}`);
  if (dryRun) return;

  const result = isWindows
    ? spawnSync([command, ...args].map(shellQuote).join(" "), {
        cwd: rootDir,
        stdio: "inherit",
        shell: true,
      })
    : spawnSync(command, args, { cwd: rootDir, stdio: "inherit" });

  if (result.error) fail(`${command} 执行失败：${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function readPm2Names(ecosystemFile) {
  const config = require(ecosystemFile);
  return (Array.isArray(config?.apps) ? config.apps : [])
    .map((app) => app?.name)
    .filter((name) => typeof name === "string" && name.length > 0);
}

function loadApps() {
  if (!existsSync(appsDir)) return [];

  return readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadApp(entry.name))
    .filter((app) => app !== null)
    .sort((left, right) => left.dirName.localeCompare(right.dirName));
}

function loadApp(dirName) {
  const dir = path.join(appsDir, dirName);
  const packageFile = path.join(dir, "package.json");
  if (!existsSync(packageFile)) return null;

  const packageName = JSON.parse(readFileSync(packageFile, "utf8")).name;
  if (typeof packageName !== "string" || packageName.length === 0) return null;

  const ecosystemFile = path.join(dir, "ecosystem.config.cjs");
  const hasEcosystemFile = existsSync(ecosystemFile);

  return {
    dirName,
    packageName,
    aliases: [dirName, packageName, packageName.split("/").pop()],
    ecosystemFile: hasEcosystemFile ? ecosystemFile : null,
    pm2Names: hasEcosystemFile ? readPm2Names(ecosystemFile) : [],
  };
}

function selectApps(apps, inputs) {
  if (inputs.length === 0 || inputs.includes("all")) return apps.filter((app) => app.ecosystemFile);

  const selected = [];
  for (const input of inputs) {
    const normalized = input.replace(/^\.?\/?(apps\/)?/, "").replace(/\/+$/, "");
    const app = apps.find((candidate) => candidate.aliases.includes(normalized));
    if (!app) {
      fail(
        `未找到应用 ${input}；可用应用：${apps.map((item) => item.dirName).join(" / ") || "（无）"}`,
      );
    }
    if (!selected.includes(app)) selected.push(app);
  }
  return selected;
}

function buildApp(app) {
  log(`构建 ${app.packageName}`);
  run("vp", ["run", `${app.packageName}#build`]);
}

function requireEcosystemFile(app) {
  if (!app.ecosystemFile) fail(`${app.dirName} 没有 ecosystem.config.cjs，无法用 PM2 管理`);
  return toRelative(app.ecosystemFile);
}

function requirePm2Names(app) {
  if (app.pm2Names.length === 0) fail(`${app.dirName} 的 ecosystem.config.cjs 里没有声明应用名`);
  return app.pm2Names;
}

/** 每个应用用自己的 ecosystem.config.cjs，新增应用后不需要再同步根配置。 */
function ecosystemTargets(selected) {
  return selected.map(requireEcosystemFile);
}

function listApps(apps) {
  if (apps.length === 0) {
    log("apps/ 下没有发现任何应用");
    return;
  }

  log("可用应用：");
  for (const app of apps) {
    const pm2Names =
      app.pm2Names.length > 0 ? app.pm2Names.join(", ") : "（无 ecosystem.config.cjs，仅可 build）";
    console.log(`  ${app.dirName.padEnd(10)} ${app.packageName.padEnd(14)} pm2: ${pm2Names}`);
  }
}

function main() {
  const [, , rawCommand, ...rest] = process.argv;
  const separatorIndex = rest.indexOf("--");
  const ownArgs = separatorIndex === -1 ? rest : rest.slice(0, separatorIndex);
  const passthrough = separatorIndex === -1 ? [] : rest.slice(separatorIndex + 1);

  dryRun = ownArgs.includes("--dry-run");
  const skipBuild = ownArgs.includes("--no-build");
  const inputs = ownArgs.filter((argument) => !argument.startsWith("-"));

  const command = rawCommand ?? "help";
  const apps = loadApps();

  const wantsHelp =
    ["help", "-h", "--help"].includes(command) ||
    ownArgs.includes("-h") ||
    ownArgs.includes("--help");
  if (wantsHelp) {
    console.log(USAGE);
    console.log("");
    listApps(apps);
    return;
  }
  if (command === "list") {
    listApps(apps);
    return;
  }
  if (apps.length === 0) fail("apps/ 下没有发现任何应用");

  const selected = selectApps(apps, inputs);
  const pm2Targets = () => selected.flatMap((app) => requirePm2Names(app));

  switch (command) {
    case "build": {
      for (const app of selected) buildApp(app);
      return;
    }
    case "deploy": {
      const files = ecosystemTargets(selected);
      if (!skipBuild) for (const app of selected) buildApp(app);
      for (const file of files) run("pm2", ["startOrRestart", file]);
      return;
    }
    case "start":
    case "restart": {
      for (const file of ecosystemTargets(selected)) run("pm2", [command, file]);
      return;
    }
    case "stop":
    case "delete": {
      run("pm2", [command, ...pm2Targets()]);
      return;
    }
    case "logs": {
      run("pm2", ["logs", ...pm2Targets(), ...passthrough]);
      return;
    }
    default:
      fail(`未知命令 ${command}，可用命令见 pnpm app --help`);
  }
}

main();
