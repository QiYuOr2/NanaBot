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

NanaBot 是支持 QQ 官方 API 与 NapCat WebSocket 的 TypeScript QQ 机器人：监听 B 站直播间开播/下播并向 QQ 群推送通知，另有一个 Nuxt 4 Web 面板展示直播状态。仓库为 pnpm workspace，由 Vite+（`vp`）统一管理。

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
  qq/                  # QQ 官方通信、独立消息类型、@全体编码及扫码授权
  storage/             # db/ 下 YAML + SQLite 存储（live-status / push-log / danmu）
  utils/               # 通用工具
  wordcloud/           # 弹幕分词、场次统计、词云 SVG/PNG 渲染（纯计算，无 NapCat 依赖）
```

## 关键约定

- 单一职责：`src/` 按职责拆分，`index.ts` 只做导出桶（barrel）。
- 共享常量放 `@nana/constants`；通用逻辑（项目根定位、深层赋值等）放 `@nana/utils`，避免重复实现。
- 测试放 `tests/`（bot 为 `test/`），用 `vite-plus/test`；storage 测试用临时 rootDir 隔离，不写真实项目数据。
- 直播状态字段：`room_id, streamer, live, updated_at, title, area, viewer`；`@nana/storage` 打开旧库会自动补列。
- 推送记录字段：`target_id, target, purpose, purpose_label, pushed_at, success, error, content, subject`。推送目的事件名与展示名收口在 `@nana/constants`（`PUSH_LOG_PURPOSES`、`PUSH_PURPOSE_LABELS`），`@nana/storage` 提供 `writePushLog` / `readPushLogs`。
- bot 业务通过 `BotApp` / `FeatureContext` 发送群消息。NapCat 使用 `core/napcat.ts` 的 `NapcatPushClient`，`get_group_info` 解析群昵称（失败回退 `群{id}`，带缓存）；官方通道使用 `qq/push.ts` 的 `OfficialPushClient`，由配置将数字群别名映射到 `group_openid`，群名取配置。两种通道成功与失败都会写推送记录，发送失败抛出原始错误，由调用方决定是否再通知管理员。
- 弹幕词云：开播开始记录弹幕、下播停止并按场次生成词云推送到管理员群。场次与弹幕存 `db/danmu.sqlite`（`danmu_session` / `danmu_message`），`@nana/storage` 提供 `openDanmuSession` / `appendDanmuMessages` / `closeDanmuSession` / `listDanmuSessions` 等。录制编排在 `apps/bot/src/danmu`（`DanmuRecorder` + `wordCloudFeature`），分词/统计/渲染在 `@nana/wordcloud`。配置段 `nana.config.yaml#wordcloud`，技术方案见 `docs/plan/danmu-wordcloud.md`。

## 运行时配置

- 根目录 `nana.config.yaml`：本地直播监控配置与顶层 `accounts` 账号列表（全量示例 `nana.config.yaml.example`），同时作为项目根目录标记（`@nana/config` 读取）；该文件已 gitignore，不提交真实群号、账号或邮箱。
- `apps/bot/.env`（参考 `.env.example`）：`NC_WS_URL`、`NC_ACCESS_TOKEN`、`NC_DEBUG`、`BARK_KEY`、`NANA_BOT_CONTROL_PORT`，变量名收口在 `@nana/constants` 的 `ENV_KEYS`。
- 多 QQ：顶层 `accounts` 统一配置多账号，每项显式 `provider: official | napcat`，连接参数放同名子段；主播必须通过 `up[].qqAccount` 显式选账号，未配置时不分配账号、不启动该主播的账号监控及录制、不推送；没有默认账号回退。允许两种通道同时运行；单账号失败不改发到其他账号。解析归一化在 `@nana/config`，凭据、路由、应用工厂及启动隔离在 `apps/bot/src/accounts/`。只支持顶层账号列表和同名连接子段，不保留旧配置兼容；群映射保存到 `accounts[].groups`。
- 官方 QQ：`accounts[].provider: official` 选择官方通道，连接参数放 `official` 子段，可沿用 `qqAccount` 标识。凭据通过 `QQ_BOT_APP_ID` / `QQ_BOT_APP_SECRET` 或账号指定的环境变量读取；`groups.<数字别名>.openid` 必须配置，不能直接用 QQ 群号。`qq:bind` 扫码写入 `.env`，`qq:discover` 获取群 openid。群主需授权主动发言；`{@all}` 转为官方文本标记 `<qqbot-at-everyone />`，机器人需为群管理员且每群每天限一次（官方 2026-10-26 变更）。发送失败不得省略提醒后重发为普通群消息。服务选择只以账号的 `provider` 为准。
- 群映射支持在 site「设置」中编辑，管理口令为 `apps/site/.env#NANA_SITE_CONFIG_TOKEN`（至少 16 位，或通过进程环境变量配置）；测试消息经 `NANA_BOT_CONTROL_URL` 调用 bot 控制接口。bot 自动记录群消息/入群事件中的 openid 到 `db/qq-group.sqlite`，按账号隔离供页面选择；未绑定群不阻止连接，只跳过推送。`@nana/config` 共享 QQ 配置解析与单群原子更新，保留 YAML 注释；群映射在每次发送时读取，保存无需重启 bot。接口只返回展示数据，不返回机器人密钥。
- 官方 SDK 只由 `@nana/qq` 依赖：`QQClient` 统一连接事件、独立的 `QQMessagePart`、发送及 `QQSendError`；`@nana/qq/connect` 提供扫码授权。该包不依赖 NapCat、配置、存储或 bot。OneBot 消息段转换、群映射、发现群持久化和推送日志留在 `apps/bot/src/qq`。bot 与 `qq:discover` 统一使用该客户端；site 不依赖 `@nana/qq`、不读取机器人凭据，只把设置页测试消息转发给 bot 的 `127.0.0.1:6365` 内部控制接口（`NANA_BOT_CONTROL_URL` 可改）。bot 用运行中的 `BotApp.sendGroupMsg` 按账号发送，推送记录也由 bot 写入；普通与 @全体均记录 `message.test`，失败不降级重发。控制接口复用 `NANA_SITE_CONFIG_TOKEN` 鉴权，应用 `.env` 读取复用 `@nana/utils.readAppEnvValue`。
- `db/*.sqlite`：运行时 SQLite（`live-status.sqlite` / `push-log.sqlite` / `danmu.sqlite`，已 gitignore）。
- `apps/site/ecosystem.config.cjs`：site 的 PM2 配置，端口 `6364`（`PORT`），运行 `.output/server/index.mjs`。

## 常用命令（仓库根执行）

- `vp install` / `pnpm install` —— 安装并链接 workspace（按 devEngines 锁定 pnpm 11.20.0）。
- `vp check` —— 格式化 + lint + 类型检查；`vp test` —— 运行 Vitest。
- `vp run @nana/bot#build` —— 构建 bot（含 workspace 依赖）。
- `pnpm dev:site` —— site 开发服务器（默认 3000）；`pnpm build:site` —— 构建 site（`.output/`）。
- `pnpm app <list|build|deploy|start|restart|stop|delete|logs> [应用名...|all]` —— 按应用名操作单个应用（应用从 `apps/*` 自动发现，新增应用不需要加脚本）：`pnpm app deploy <应用>` 构建并只重启该应用；`all` 指带 `ecosystem.config.cjs` 的可部署应用。
- 前端技能包（Vue/Nuxt/UnoCSS 等）安装在 `.agents/skills/`。
