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
  bilibili-api/        # Bilibili API
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

### 运行 Web 面板

```bash
pnpm dev:site                                            # 开发（http://localhost:3000）
pnpm build:site                                          # 生产构建（.output/）
pm2 start apps/site/ecosystem.config.cjs                 # 生产运行，端口 6364
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

## 常用脚本

| 命令                                             | 说明                          |
| ------------------------------------------------ | ----------------------------- |
| `pnpm dev:site`                                  | 启动 Web 开发服务器           |
| `pnpm build:site`                                | 构建 Web 面板                 |
| `pnpm build:bot`                                 | 构建 bot（含 workspace 依赖） |
| `pnpm pm2:start` / `restart` / `stop` / `delete` | PM2 管理 bot + site           |
| `vp check` / `vp test`                           | 格式化、lint、类型检查 / 测试 |
