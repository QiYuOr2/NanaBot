# NanaBot

基于 NapCat WebSocket 的 TypeScript QQ 机器人：监听 B 站直播间开播 / 下播，向 QQ 群推送通知，
并提供一个 Web 面板展示主播实时直播状态。

基于 pnpm workspace 的 monorepo，由 [Vite+](https://viteplus.dev)（`vp`）统一管理。

## 功能

- 多 B 站直播间开播 / 下播监控
- 开播、下播、连接状态 QQ 群通知（NapCat）
- 推送记录：所有群推送（开播、应用上线 / 下线、管理员通知）无论成功或失败都写入
  `db/push-log.sqlite`，并可在 Web 面板查看最近推送与送达状态
- 直播状态持久化到 SQLite（`db/live-status.sqlite`）
- Web 面板展示主播实时直播状态、标题、分区与人数，卡片可手动刷新；并排展示
  「最近推送活动」时间轴（`apps/site`）

## 目录结构

```text
apps/
  bot/                 # QQ 机器人应用
  site/                # 直播状态 Web 面板（Nuxt 4 + Vite+ + UnoCSS）
packages/
  bilibili-api/        # Bilibili API https://github.com/pskdje/bilibili-API-collect
  config/              # nana.config.yaml 读写
  constants/           # 共享常量
  monitor/             # 直播监控抽象
  storage/             # db/ 下的 YAML 与 SQLite 存储
  utils/               # 通用工具
nana.config.yaml       # 直播监控配置
ecosystem.config.cjs   # PM2 入口
```

## 环境要求

- Node.js >= 22.18.0
- pnpm 11.20.0
- 可用的 NapCat WebSocket 服务

## 快速开始

### 安装

```bash
pnpm install
```

### 运行 Bot

1. 参考 `apps/bot/.env.example` 配置 `.env`
2. 在 `nana.config.yaml` 配置要监控的主播
3. 构建并启动：

```bash
pnpm build:bot
node apps/bot/dist/index.mjs
```

或使用 PM2：

```bash
pnpm pm2:start   # 同时启动 bot 与 site
```

只部署 bot 时用 `pnpm app deploy bot`（见[部署](#部署)）。

### 运行 Web 面板

```bash
pnpm dev:site                                            # 开发（http://localhost:3000）
pnpm build:site                                          # 生产构建（.output/）
pm2 start apps/site/ecosystem.config.cjs                 # 生产运行，端口 6364
```

## 部署

bot 与 site 是相互独立的 PM2 应用（`@nana/bot` / `@nana/site`），只改了其中一个时
可以单独部署，不必动另一个。应用名从命令行传入，应用列表由 `apps/*` 自动发现，
以后新增应用不需要再改脚本：

```bash
pnpm app list              # 列出可管理的应用（目录名 / 包名 / PM2 进程名）
pnpm app deploy bot        # 构建 bot + 只重启 @nana/bot
pnpm app deploy site       # 构建 site + 只重启 @nana/site
pnpm app deploy all        # 两个都部署
```

应用名可写目录名（`bot`）、包名（`@nana/bot`）或路径（`apps/bot`）。不重新构建、
只想重启或停止时：

```bash
pnpm app restart site      # pm2 restart apps/site/ecosystem.config.cjs
pnpm app stop bot          # pm2 stop @nana/bot
pnpm app logs bot          # pm2 logs @nana/bot
pnpm app deploy bot --no-build   # 跳过构建，只做 PM2 重启
```

`all` 指 `apps/` 下所有带 `ecosystem.config.cjs` 的可部署应用；没有该文件的目录
（例如不进 PM2 的工具）不会被 `all` 带上，需要时用应用名显式指定。

两个应用的 PM2 配置各自独立（`apps/bot/ecosystem.config.cjs` /
`apps/site/ecosystem.config.cjs`），根目录 `ecosystem.config.cjs` 只是把两者合并，
供 `pnpm pm2:*` 一起管理；`pnpm app` 则直接用各应用自己的配置，两者效果一致。

### Bot 日志

Bot 会自己把日志写到项目根目录（即使 PM2 的 `cwd` 是 `apps/bot`），不依赖 PM2 日志文件：

```text
logs/
  bot.log                       # 进程启动、停机、账号跳过等全局事件
  accounts/
    2799397589.log              # 主号自己的连接、监控、推送、弹幕日志
    2227511984.log              # 饭总号自己的日志
```

每个账号写自己的文件，不会混在一起。单个文件默认达到 10 MiB 后轮转，保留 5 份历史
（`bot.log.1` … `bot.log.5`）。控制台仍会同步输出，`pnpm app logs bot` 只用于实时观察；
排查历史问题时直接看文件：

```bash
tail -f logs/bot.log
tail -n 200 logs/accounts/2227511984.log
```

## 配置

`nana.config.yaml` 中，只有 `live: true` 的主播会被监控：

```yaml
up:
  - live: true
    uid: 145149047
    liveRoomId: 4629447
    uname: 饭总
    liveMonitorConfig:
      enableNotify: true
      notifyGroups:
        - 123456789
      messageTemplate:
        start: "{uname}播了 http://live.bilibili.com/{roomId} {@all}"
```

| 字段                                      | 说明                                           |
| ----------------------------------------- | ---------------------------------------------- |
| `live`                                    | 是否监控该主播                                 |
| `uid` / `liveRoomId` / `uname`            | B 站用户 ID / 直播间 ID / 主播名               |
| `liveMonitorConfig.enableNotify`          | 是否发送 QQ 群通知                             |
| `liveMonitorConfig.notifyGroups`          | 通知群号                                       |
| `liveMonitorConfig.messageTemplate.start` | 开播文案，支持 `{uname}`、`{roomId}`、`{@all}` |

### 多 QQ 号（多个 NapCat 实例）

NapCat 一个实例只能登录一个 QQ 号，所以两个 QQ 号需要两个 NapCat 实例、两个 WebSocket
端口。NanaBot 仍然只跑一个进程，通过 `nana.config.yaml#napcat.accounts` 同时连接它们：

```yaml
napcat:
  accounts:
    - id: main
      name: 主号
      wsUrl: ws://127.0.0.1:1111
      accessTokenEnv: NC_ACCESS_TOKEN
      adminGroup: 1111111
    - id: second
      name: 副号
      wsUrl: ws://127.0.0.1:2222
      accessTokenEnv: NC_ACCESS_TOKEN_2
      adminGroup: 2222222

up:
  - live: true
    uid: 145149047
    liveRoomId: 4629447
    uname: 饭总
    qqAccount: second # 该主播的开播、词云、摘要都走副号
    liveMonitorConfig:
      enableNotify: true
      notifyGroups:
        - 123456789
```

- `id` 只能包含字母、数字、`_`、`-`，用于 `up[].qqAccount` 引用。
- `wsUrl` 可以直接写地址，也可以用 `wsUrlEnv` 指向 `.env` 变量；配置了 `wsUrlEnv` 时不会回退 `NC_WS_URL`。
- `accessTokenEnv` 指向 `.env` 中的变量名；也可以直接写 `accessToken`（不推荐）。
- 账号省略 `wsUrl` 时沿用 `NC_WS_URL`；`adminGroup` 不继承全局 `ADM_GROUP`，多账号必须各自配置管理群。
- 第一个账号是主账号，必须能解析出连接变量；后续账号缺少变量时只跳过该账号，不阻塞主账号启动。
- NapCat 实例暂时未启动时会在后台持续重连；某个账号启动失败也只会停用它自己，其它账号照常运行。
- `up[].qqAccount` 不写时使用第一个账号，已有单账号配置可以原样运行。
- 不写 `napcat.accounts` 时继续读取旧的 `NC_WS_URL` / `NC_ACCESS_TOKEN` / `ADM_GROUP`。
- 每个账号有独立的连接看门狗；离线告警邮件会在标题前加 `[账号名]`。
- 每个账号的上线 / 下线群提示发送到该账号自己的 `adminGroup`，不会共用全局群。
- 推送记录会写入 `account` 列，便于区分是哪个 QQ 发出的。

## 变更记录

功能改动的文档在 [docs/changes/](./docs/changes/README.md)，按「概览 → 明细」两级组织：

- [概览](./docs/changes/README.md)：每次改动改了什么、为什么、影响范围、验证结果与未决事项；
- 明细文档：一次改动一篇，记录背景、文件级变更、关键决策与取舍、兼容性与数据安全、验证方式。

新增改动时复制 [docs/changes/TEMPLATE.md](./docs/changes/TEMPLATE.md)，编号递增，并在概览索引里补一行。

## 常用脚本

| 命令                                             | 说明                            |
| ------------------------------------------------ | ------------------------------- |
| `pnpm dev:site`                                  | 启动 Web 开发服务器             |
| `pnpm build:site`                                | 构建 Web 面板                   |
| `pnpm build:bot`                                 | 构建 bot（含 workspace 依赖）   |
| `pnpm app list`                                  | 列出可管理的应用                |
| `pnpm app deploy <应用...\|all>`                 | 构建 + 部署指定应用（默认 all） |
| `pnpm app build\|start\|restart\|stop\|delete`   | 只做对应动作，`logs` 跟随日志   |
| `pnpm pm2:start` / `restart` / `stop` / `delete` | PM2 管理全部应用（bot + site）  |
| `vp check` / `vp test`                           | 格式化、lint、类型检查 / 测试   |
