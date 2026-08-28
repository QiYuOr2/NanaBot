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

NanaBot 是基于 NapCat WebSocket 的 TypeScript QQ 机器人：监听 B 站直播间开播/下播并向 QQ 群推送通知，另有一个 Nuxt 4 Web 面板展示直播状态。仓库为 pnpm workspace，由 Vite+（`vp`）统一管理。

## 目录结构

```text
apps/
  bot/                 # QQ 机器人应用
  site/                # 直播状态 Web 面板（Nuxt 4 + Vite+ + UnoCSS）
packages/
  bilibili-api/        # B 站直播状态 API（getLiveStatusByUids）
  config/              # nana.config.yaml 读写
  constants/           # 共享常量
  monitor/             # 直播监控 source/controller/event/sink 抽象
  storage/             # db/ 下 YAML + SQLite 存储
  utils/               # 通用工具
```

## 关键约定

- 单一职责：`src/` 按职责拆分，`index.ts` 只做导出桶（barrel）。
- 共享常量放 `@nana/constants`；通用逻辑（项目根定位、深层赋值等）放 `@nana/utils`，避免重复实现。
- 测试放 `tests/`（bot 为 `test/`），用 `vite-plus/test`；storage 测试用临时 rootDir 隔离，不写真实项目数据。
- 直播状态字段：`room_id, streamer, live, updated_at, title, area, viewer`；`@nana/storage` 打开旧库会自动补列。

## 运行时配置

- 根目录 `nana.config.yaml`：直播监控配置，同时作为项目根目录标记（`@nana/config` 读取）。
- `apps/bot/.env`（参考 `.env.example`）：`NC_WS_URL`、`NC_ACCESS_TOKEN`、`ADM_GROUP`、`NC_DEBUG`、`BARK_KEY`，变量名收口在 `@nana/constants` 的 `ENV_KEYS`。
- `db/live-status.sqlite`：运行时 SQLite（已 gitignore）。
- `apps/site/ecosystem.config.cjs`：site 的 PM2 配置，端口 `6364`（`PORT`），运行 `.output/server/index.mjs`。

## 常用命令（仓库根执行）

- `vp install` / `pnpm install` —— 安装并链接 workspace（按 devEngines 锁定 pnpm 11.20.0）。
- `vp check` —— 格式化 + lint + 类型检查；`vp test` —— 运行 Vitest。
- `vp run @nana/bot#build` —— 构建 bot（含 workspace 依赖）。
- `pnpm dev:site` —— site 开发服务器（默认 3000）；`pnpm build:site` —— 构建 site（`.output/`）。
- 前端技能包（Vue/Nuxt/UnoCSS 等）安装在 `.agents/skills/`。
