<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# NanaBot 项目说明

NanaBot 是基于 NapCat WebSocket 的 TypeScript QQ 机器人，核心是监听 B 站直播间开播/下播并向 QQ 群推送通知。仓库为 pnpm workspace，由 Vite+（`vp`）统一管理。

## 目录结构

```text
apps/
  bot/                 # 可运行的 QQ 机器人应用
packages/
  bilibili-api/        # Bilibili REST API 类型与请求封装
  config/              # 项目配置文件 nana.config.yaml 的定位与读写
  constants/           # 跨项目共享的字符串常量
  monitor/             # 直播监控 source/controller/event/sink 抽象
  storage/             # db/ 下的运行时数据（YAML + SQLite 直播状态）
  utils/               # 通用工具
```

## 包职责与依赖方向

- `@nana/constants` —— 无依赖。集中存放 `NANA_CONFIG_FILE`（`nana.config.yaml`）、`DATABASE_DIRECTORY`（`db`）、`LIVE_STATUS_FILE`（`live-status.sqlite`）、`DEFAULT_NC_WS_URL`、`ENV_KEYS`、Bark 地址/图标。
- `@nana/utils` —— 依赖 `@nana/constants` + `dayjs`。通用工具，重点是 `resolveProjectRoot()`（定位项目根目录）、`setDeepPath()`（对象深层赋值），另有 `barkURL`、`dateFormat`、`readOptionalNumberEnv`。源码按职责拆分（`bark.ts` / `date.ts` / `env.ts` / `project.ts` / `deep-path.ts`），`index.ts` 仅做导出桶。
- `@nana/config` —— 依赖 `@nana/constants`、`@nana/utils`、`js-yaml`。读写根目录 `nana.config.yaml`，复用 utils 的 `resolveProjectRoot` / `setDeepPath`。
- `@nana/storage` —— 依赖 `@nana/constants`、`@nana/utils`、`js-yaml`。持久化 `db/` 下运行时数据：YAML 存储（`readStore`/`writeStore`/`updateStore`）与 SQLite 直播状态（`writeLiveStatus`/`readLiveStatus`，落盘 `db/live-status.sqlite`）。源码拆为 `types.ts` / `paths.ts` / `yaml-store.ts` / `live-status.ts`，`index.ts` 为导出桶。
- `@nana/monitor` —— 依赖 `blive-message-listener`。直播监控的 source/controller/event/sink 抽象。
- `@nana/bot` —— 依赖 config/constants/monitor/storage/utils + `dotenv`、`node-napcat-ts`、`zod`。组装应用。

`config` 与 `storage` 是平级关系，共同依赖 `@nana/utils`，彼此不互相依赖。

## 运行时配置

- `nana.config.yaml`（仓库根）—— 直播监控配置，由 `@nana/config` 读取，同时作为项目根目录标记。
- `apps/bot/.env`（不入库，参考 `apps/bot/.env.example`）—— 环境变量 `NC_WS_URL`、`NC_ACCESS_TOKEN`、`ADM_GROUP`、`NC_DEBUG`、`BARK_KEY`；变量名统一收口在 `@nana/constants`（`ENV_KEYS`）。
- `db/live-status.sqlite` —— 运行时 SQLite，已被 gitignore。

## 约定

- 单一职责：包与模块职责单一，`src/` 按职责拆分，`index.ts` 只做导出桶（barrel）。
- 共享常量放 `@nana/constants`；通用逻辑（项目根定位、深层赋值等）放 `@nana/utils`，避免 `config`/`storage` 重复实现。
- 测试：包内测试放 `tests/`（bot 为 `test/`），使用 `vite-plus/test`。storage 测试用 `mkdtempSync(tmpdir())` 生成隔离的临时 rootDir，避免写入真实项目数据。

## 常用命令（默认在仓库根执行）

- `vp install` / `pnpm install` —— 安装并链接 workspace（按 devEngines 锁定 pnpm 11.20.0）。
- `vp check` —— 格式化 + lint + 类型检查（包内或根目录）。
- `vp test` —— 运行 Vitest。
- `vp run @nana/bot#build` —— 构建 bot 应用（会先行 pack 其 workspace 依赖）。
- `vp pack` —— 在某个 package 内构建该包的 dist。

- 前端相关技能包（Vue/Nuxt/Pinia/UnoCSS 等）已安装在 `.agents/skills/`，后续若按 `docs/status-page-plan.md` 建设状态前端时可直接使用。
