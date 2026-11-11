# NanaBot

支持 QQ 官方 API 与 NapCat WebSocket 的 TypeScript QQ 机器人：监听 B 站直播间开播 / 下播，向 QQ 群推送通知，
并提供一个 Web 面板展示主播实时直播状态。

基于 pnpm workspace 的 monorepo，由 [Vite+](https://viteplus.dev)（`vp`）统一管理。

## 功能

- 多 B 站直播间开播 / 下播监控
- 直播与连接状态 QQ 群通知，支持 QQ 官方机器人 / NapCat 两种通道
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
- QQ 官方机器人的 AppID / AppSecret，或可用的 NapCat WebSocket 服务

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

### QQ 官方机器人（推荐用于新接入）

使用腾讯维护的 [`@tencent-connect/qqbot-nodejs`](https://github.com/tencent-connect/qqbot-nodejs)
连接官方 WebSocket Gateway，SDK 负责 access token 刷新、心跳与重连。无需部署 NapCat 或公网回调服务。
原有 NapCat 代码和配置继续保留；没有 `qq` 配置时保持旧行为。

1. 在 [QQ 开放平台](https://q.qq.com/)创建机器人，或通过
   [官方 Agent 接入入口](https://bot.q.qq.com/wiki/agent-qqbot/)快捷创建。
2. 在 `nana.config.yaml` 增加下方 `qq` 配置；`id` 可以沿用原来的 NapCat 账号标识，
   这样 `up[].qqAccount`、开播通知群与词云群均不用改。启用官方通道后只读取 `qq.accounts`。
3. 在 `apps/bot/.env` 填写 `QQ_BOT_APP_ID` / `QQ_BOT_APP_SECRET`，或在仓库根目录扫码绑定：

```bash
vp run @nana/bot#qq:bind 2227511984
```

扫码使用官方 `@tencent-connect/qqbot-connector`，凭据直接写入 `apps/bot/.env`，不打印密钥。
命令缺省选择 `qq.accounts` 中第一个账号，Ctrl+C 可取消。多个机器人需分别配置不同的
`appIdEnv` / `appSecretEnv`，再按账号 ID 分别绑定。

```yaml
qq:
  provider: official # 改为 napcat 可切回原通道
  accounts:
    - id: "2227511984" # 本地路由标识，不是 AppID
      name: 饭总机器人
      appIdEnv: QQ_BOT_APP_ID
      appSecretEnv: QQ_BOT_APP_SECRET
      sandbox: false # 开发沙箱可设 true
      # 获取映射前可以不写 adminGroup，groups 留空，先运行 qq:discover。
      adminGroup: 1101365727
      groups:
        "1101365727":
          openid: "此机器人收到的该群 group_openid"
          name: 饭友群
        "511731882":
          openid: "另一个目标群的 group_openid"
          name: 直播通知群
        # 为该账号负责的所有通知群、词云群、管理群补齐映射。
```

官方 API 的 `group_openid` 是字符串，与 QQ 群号不同，也不能跨机器人复用。
`groups` 的数字键仅作为本地别名，可以继续使用现有群号；实际请求与推送记录中的
`target_id` 使用官方 openid，群展示名取 `name`，未填写时显示「群+别名」。

4. 获取群标识（无需提前填写映射，不启动 B 站监控，也不主动发消息）：

```bash
vp run @nana/bot#qq:discover 2227511984
```

连接后将机器人加入目标群，或在目标群里 @机器人 发一条消息，终端会显示该账号收到的
`group_openid`。逐个填入 `groups`，完成后 Ctrl+C 退出发现工具，再正常启动 bot。
不要让发现工具与运行中的同一机器人账号同时连接。

5. 由群主在机器人设置中开启「机器人主动在群聊内发言」。需要接收普通群消息时，可另开
   「获取群内全部消息」；用于获取映射的 @消息不要求接收全部群消息。
   若消息带直播链接，还需按开放平台要求配置消息 URL / 域名白名单，并配置服务端 IP 白名单、
   沙箱成员及上线权限等平台设置。
6. 执行 `vp run @nana/bot#build`，再按现有方式启动或部署 bot。

官方通道复用开播通知、管理群上线 / 下线通知、词云 PNG、直播摘要、推送记录和邮件 / Bark
离线告警。词云通过官方媒体 API 上传本地图片，再发送带正文的媒体消息；失败沿用纯文字降级。
平台返回的发送失败会写入失败记录并向业务层抛出，不会当作送达成功。

启动前会检查账号归属和所有群映射；缺少凭据 / 映射会明确报错，不会回退发到其他通道或群。
官方 SDK 的 READY / RESUMED 表示连接可用，持续断连 90 秒后触发离线告警；NapCat 原有心跳
检测保持原样。官方群消息接口没有 OneBot 的 @全体成员消息段，`{@all}` 会被省略并写入日志。
主动消息最终能否送达仍取决于群授权、机器人权限与平台频率限制。

参照：[官方 API 准备工作](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/getting-started.html)、
[当前 Agent 接入及群权限说明](https://bot.q.qq.com/wiki/agent-qqbot/)、
[SDK 使用文档](https://github.com/tencent-connect/qqbot-nodejs/blob/main/USAGE.md)。
旧版 API 文档曾公告停止主动推送，当前 Agent 文档已说明群主可授权主动发言，部署应以
当前机器人实际开放权限为准。

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
