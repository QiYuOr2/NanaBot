# NanaBot

支持 QQ 官方 API 与 NapCat WebSocket 的 TypeScript QQ 机器人：监听 B 站直播间开播 / 下播，向 QQ 群推送通知，
并提供一个 Web 面板展示主播实时直播状态。

基于 pnpm workspace 的 monorepo，由 [Vite+](https://viteplus.dev)（`vp`）统一管理。

## 工程架构

![NanaBot 工程架构图](./docs/architecture/nanabot-architecture.svg)

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
  qq/                  # QQ 官方通信、消息类型、发送校验与扫码授权
  storage/             # db/ 下的 YAML 与 SQLite 存储
  utils/               # 通用工具
nana.config.yaml       # 本地直播监控配置（已 gitignore，不提交）
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
2. 复制 `nana.config.yaml.example` 为 `nana.config.yaml`，配置账号与要监控的主播（已有配置可直接沿用）
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
pm2 start apps/site/ecosystem.config.cjs                 # 生产运行，端口 3000
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
pnpm app deploy site --stop-before-build  # 构建前先停应用，降低小内存机器 OOM 风险
```

`all` 指 `apps/` 下所有带 `ecosystem.config.cjs` 的可部署应用；没有该文件的目录
（例如不进 PM2 的工具）不会被 `all` 带上，需要时用应用名显式指定。
`--stop-before-build` 只影响 `deploy`；构建失败时会尝试重新启动原先停止的应用。

两个应用的 PM2 配置各自独立（`apps/bot/ecosystem.config.cjs` /
`apps/site/ecosystem.config.cjs`），根目录 `ecosystem.config.cjs` 只是把两者合并，
供 `pnpm pm2:*` 一起管理；`pnpm app` 则直接用各应用自己的配置，两者效果一致。

### 在 CI 构建 site

小内存服务器不建议运行 `pnpm build:site`。推送 `v2` 且涉及 site 或其依赖包时，
[`site.yml`](./.github/workflows/site.yml) 会在 Linux x64 上构建并上传
`site-output-<sha>` artifact，服务器只接收产物并重启 PM2。

配置以下 GitHub Actions secrets 后会自动部署，否则仅保留 artifact：

```text
DEPLOY_HOST      服务器地址
DEPLOY_PORT      SSH 端口，可选，默认 22
DEPLOY_USER      SSH 用户
DEPLOY_SSH_KEY   SSH 私钥
DEPLOY_PATH      服务器仓库绝对路径，例如 /root/NanaBotV2
```

配置完成后无需再在服务器执行 `pnpm build:site`；workflow 会解包到临时目录，
根据服务器 PM2 配置的启动入口替换 `apps/site/.output`、重启 `@nana/site`，
并在健康检查失败时回滚。健康检查访问 `/api/health`，端口从同一份 PM2 配置读取，
不会固定检查仓库根目录产物或默认端口。

### Bot 日志

Bot 会自己把日志写到项目根目录（即使 PM2 的 `cwd` 是 `apps/bot`），不依赖 PM2 日志文件：

```text
logs/
  bot.log                       # 进程启动、停机、账号跳过等全局事件
  accounts/
    100000001.log               # 主号自己的连接、监控、推送、弹幕日志
    100000002.log               # 第二账号自己的日志
```

每个账号写自己的文件，不会混在一起。单个文件默认达到 10 MiB 后轮转，保留 5 份历史
（`bot.log.1` … `bot.log.5`）。控制台仍会同步输出，`pnpm app logs bot` 只用于实时观察；
排查历史问题时直接看文件：

```bash
tail -f logs/bot.log
tail -n 200 logs/accounts/100000002.log
```

## 配置

全量配置见 [`nana.config.yaml.example`](./nana.config.yaml.example)，包含两种 QQ 通道、多账号、
群映射、直播通知、词云与离线告警。机器人凭据放 `apps/bot/.env`，项目管理口令放根目录 `.env`。
`nana.config.yaml` 是本地运行时配置，包含真实群号和账号信息，已加入 `.gitignore`，不要提交。

### 账号与通道

账号统一放在顶层 `accounts`，每个账号用 `provider` 选择自己的服务，可同时运行官方机器人和
NapCat。公共字段为 `id`、`name`、`adminGroup`；连接参数放在同名的 `official` / `napcat` 子段中。
`groups` 是官方账号自己的群映射，NapCat 直接使用 QQ 群号，无需这个字段。

```yaml
accounts:
  - id: main
    provider: napcat
    napcat:
      wsUrlEnv: NC_WS_URL
      accessTokenEnv: NC_ACCESS_TOKEN
  - id: live
    provider: official
    official:
      appIdEnv: QQ_BOT_APP_ID
      appSecretEnv: QQ_BOT_APP_SECRET
    groups: {} # 启动后在 site 绑定
```

- `up[].qqAccount` 显式指定发送账号，其开播、词云、摘要均由这个账号发送；未填写时不分配
  账号，不启动该主播的账号监控与录制功能，也不推送。没有默认账号或首项回退。
- 服务选择只看该账号的 `provider`，不会根据 AppID 是否存在或连接是否成功切换通道。
- 新账号列表中，单个账号缺少凭据或启动失败只影响自己；其他账号继续运行。指定账号不可用时，
  它负责的主播暂时跳过，不会转给其他账号。全部账号不可用时启动失败。
- 每个账号独立连接、独立管理群与日志。多个 NapCat 账号需要不同实例 / 端口；多个官方机器人
  必须使用独立的 AppID 和凭据环境变量。
- 修改账号通道、凭据或主播归属后重新部署 bot；群映射在 site 保存后下次推送生效。

### 主播

`nana.config.yaml` 中，只有 `live: true` 的主播会被监控：

```yaml
up:
  - live: true
    uid: 10001
    liveRoomId: 1000001
    uname: 示例主播
    qqAccount: live
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

通过项目的 [`@nana/qq`](packages/qq/README.md) 通信包使用腾讯维护的
[`@tencent-connect/qqbot-nodejs`](https://github.com/tencent-connect/qqbot-nodejs)
连接官方 WebSocket Gateway，SDK 负责 access token 刷新、心跳与重连。消息编码、@全体标记及
发送结果校验集中在通信包，账号路由、群映射与推送记录由 bot 适配层处理。无需部署 NapCat 或公网回调服务。
NapCat 通道继续保留，统一通过顶层 `accounts` 配置。

1. 在 [QQ 开放平台](https://q.qq.com/)创建机器人，或通过
   [官方 Agent 接入入口](https://bot.q.qq.com/wiki/agent-qqbot/)快捷创建。
2. 在 `nana.config.yaml` 的顶层 `accounts` 增加官方账号；`id` 可以沿用原来的 NapCat 账号标识，
   这样 `up[].qqAccount`、开播通知群与词云群均不用改。设置该账号的 `provider: official`，
   AppID / AppSecret 的变量名放在该账号的 `official` 子段；完整结构见全量示例。
3. 在 `apps/bot/.env` 填写 `QQ_BOT_APP_ID` / `QQ_BOT_APP_SECRET`，或在仓库根目录扫码绑定：

```bash
vp run @nana/bot#qq:bind live
```

扫码使用官方 `@tencent-connect/qqbot-connector`，凭据直接写入 `apps/bot/.env`，不打印密钥。
命令缺省选择 `accounts` 中第一个**官方账号**，Ctrl+C 可取消；指定 NapCat 账号会明确报错。
多个机器人需在各自的 `official` 子段配置不同的 `appIdEnv` / `appSecretEnv`，再按账号 ID 分别绑定。

账号中的 `adminGroup` 仍填写数字群别名，`groups` 可先留空；获取映射后按全量示例填写，
或在 site 中保存。该账号负责的通知群、词云群和管理群均需各自绑定。

官方 API 的 `group_openid` 是字符串，与 QQ 群号不同，也不能跨机器人复用。
`groups` 的数字键仅作为本地别名，可以继续使用现有群号；实际请求与推送记录中的
`target_id` 使用官方 openid，群展示名取 `name`，未填写时显示「群+别名」。

4. 推荐通过 site「设置 → QQ 群映射」获取并保存群标识，操作见下节。机器人在线时，在群内
   @机器人发一条消息，刷新页面后选择对应候选并保存即可，无需停止或重启 bot。
   也可以使用命令行工具（无需提前填写映射，不启动 B 站监控，也不主动发消息）：

```bash
vp run @nana/bot#qq:discover live
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

启动前会检查账号归属和凭据；缺少凭据的账号会记录原因并跳过。尚未映射的群会告警并跳过推送，机器人继续
连接以发现群标识；在 site 补齐映射后，下次推送自动读取，不会回退发到其他通道或群。
官方 SDK 的 READY / RESUMED 表示连接可用，持续断连 90 秒后触发离线告警；NapCat 原有心跳
检测保持原样。开播模板中的 `{@all}` 会转为官方发送标记 `<qqbot-at-everyone />`，
机器人必须是该群管理员，且**每群每天仅能 @全体一次**。权限不足或额度耗尽时，该次推送记录为
失败并向业务层抛出错误，不会去掉 @全体后重发为普通群消息；多次开播无法保证每次都 @全体。
现有管理群通知沿用不 @全体的行为。接收事件里的 `<@all>` 是接收端表示，不用于发送。
此能力见 [官方 2026-10-26 变更记录](https://bot.q.qq.com/wiki/develop/api-v2/changelog.html#_20261026)。
主动消息最终能否送达仍取决于群授权、机器人权限与平台频率限制。

参照：[官方 API 准备工作](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/getting-started.html)、
[当前 Agent 接入及群权限说明](https://bot.q.qq.com/wiki/agent-qqbot/)、
[SDK 使用文档](https://github.com/tencent-connect/qqbot-nodejs/blob/main/USAGE.md)。
旧版 API 文档曾公告停止主动推送，当前 Agent 文档已说明群主可授权主动发言，部署应以
当前机器人实际开放权限为准。

### 账号启停与上线 / 下线提醒

`accounts[].enabled: false` 保留配置但不连接该账号，也不启动其主播监控、弹幕录制或推送。
不会把该账号的主播改发到其他账号。全部账号停用时仍可运行 bot 控制服务。
NapCat 的 `accounts[].napcat.watchdog` 默认 `false`，关闭主动探活、强制重连和库自动重连；
长期运行的 NapCat 服务可设为 `true`，恢复持续重连。修改后重启 bot。

```yaml
botNotifications:
  online:
    enabled: true
    messageTemplate: "我来了~"
  offline:
    enabled: true
    messageTemplate: "我溜了~"
```

两种提醒可独立关闭，发往各账号的管理群。模板支持 `{accountId}`、`{accountName}`、`{provider}`，
默认不自动附带账号名。下线提醒在正常 SIGINT / SIGTERM 收尾时发送，强制终止无法发送。

### 日志与服务器状态

site 侧栏的「项目日志」读取根目录 `logs/` 中的 `.log` / `.txt` / `.out` / `.err` 及数字轮转文件，
包括 `accounts/` 子目录。支持选择文件、末尾行数和手动刷新，单次最多 256 KiB / 2000 行，
拒绝目录穿越与符号链接。最多列出 500 个文件，递归深度 5 层。

「服务器状态」在进入页面或刷新时获取一次 CPU、内存、交换空间、磁盘和 NVIDIA GPU 状态，
不自动轮询。GPU 需要驱动及 `nvidia-smi`，无法读取时显示原因；Linux 展示可见的物理挂载磁盘，
其他系统展示根目录及项目所在磁盘。在容器或分离部署中，指标来自 site 所在运行环境。
`/api/health` 公开返回最小健康状态，供部署检查；其余业务 API 均受全站鉴权保护。

### 在 site 配置 QQ 群映射

首次更新后执行 `pnpm app deploy all`，同时更新 bot 与 site；后续编辑群映射无需重新部署。
两者需要使用同一项目根目录的配置与 `db/`，与当前 PM2 部署方式一致。

1. 参考根目录 `.env.example` 创建 `.env`，设置全项目共用的管理口令：

   ```dotenv
   NANA_AUTH_TOKEN=填写至少16位的随机管理口令
   ```

   可用 `openssl rand -hex 24` 生成。bot 与 site 共用此口令，按请求读取；修改后旧登录会话失效。
   原 `apps/site/.env#NANA_SITE_CONFIG_TOKEN` 仍兼容。进程中的 `NANA_AUTH_TOKEN` 优先于根目录文件。
   `apps/site/.env` 中可配置 `NANA_BOT_CONTROL_URL`，默认 `http://127.0.0.1:6365`。

2. 打开 site 后统一登录，所有业务页面和 API 都需要认证。浏览器通过 HttpOnly Cookie 记住登录
   30 天，刷新或下次进入无需重复填写；侧栏可退出登录。设置页直接使用当前会话，不再单独解锁。
   页面不会读取或返回机器人 AppSecret。
3. 页面按 `accounts` 列出每个官方机器人自己的管理群、主播通知群及词云群，NapCat 账号单独显示，
   无需绑定 openid。未填写 openid
   的群也会显示。先按原方式配置账号、AppID / AppSecret 和主播目标群即可，`groups` 可先留空。
4. 保持 bot 在线，在需要绑定的群里 @对应机器人发送一条消息。返回页面点击刷新，根据
   最近发现时间选择该账号收到的候选 `group_openid`，填写群名称并保存；也支持手动粘贴标识。
5. 保存只更新这个账号的这个群，保留 YAML 注释与其他配置，下次推送自动生效，无需构建或
   重启 bot。修改凭据、账号归属、通知群列表或通道类型仍需重启 bot。
6. 已保存 `group_openid` 的群会显示「测试普通消息」和「测试 @全体」。测试请求由 site 转发给
   运行中的 bot，由 bot 使用该账号当前的 `BotApp` 发送并写入推送记录；有未保存修改时先保存再测试。
   @全体要求机器人是群管理员，每群每天限一次，测试也占用当天额度；发送失败不会降级重发。

site 不读取机器人凭据，也不直接调用官方 API。bot 在 `127.0.0.1:6365` 提供内部控制接口
（`apps/bot/.env#NANA_BOT_CONTROL_PORT` 可改），site 通过 `NANA_BOT_CONTROL_URL` 调用，
两边共用根目录 `.env#NANA_AUTH_TOKEN`。bot 未运行时测试返回 `503`；发送仍走 bot 当前账号的
官方 / NapCat 实现，不会建立第二条 Gateway 连接。

bot 只持久化发现的群标识及最近发现时间，不存储 QQ 群聊正文。候选存于 `db/qq-group.sqlite`，
按账号隔离；更换账号绑定的 AppID 后，bot 启动时会清理该账号的旧应用候选。

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
