# NanaBot

NanaBot 是一个基于 NapCat WebSocket 的 TypeScript 机器人。当前应用为 QQ 机器人提供 Bilibili 直播间监控：监听开播、下播和连接状态，并按主播配置向 QQ 群发送通知。

项目采用 pnpm workspace 和 Vite+ 管理，应用与可复用逻辑已经拆分到 `apps/` 和 `packages/`。

## 功能

- 连接 NapCat WebSocket，接入 QQ 消息能力
- 启动和退出时向管理员群发送状态消息
- 监听多个 Bilibili 直播间的开播、下播状态
- 为每个主播配置通知群和开播文案
- 将直播状态持久化到 SQLite 数据库 `db/live-status.sqlite`
- 使用 PM2 长期运行机器人

## 环境要求

- Node.js `>=22.18.0`
- pnpm `11.20.0`
- 可用的 NapCat WebSocket 服务
- 能访问 Bilibili 直播信息的网络环境

## 快速开始

### 安装

```bash
pnpm install
```

### 配置 NapCat

在项目根目录创建 `.env`：

```env
NC_WS_URL=ws://127.0.0.1:1111
NC_ACCESS_TOKEN=your_access_token
ADM_GROUP=123456789
NC_DEBUG=1
```

- `NC_WS_URL`：NapCat WebSocket 地址，默认值为 `ws://127.0.0.1:1111`
- `NC_ACCESS_TOKEN`：NapCat 启用鉴权时填写
- `ADM_GROUP`：管理员 QQ 群号；不填写则不发送管理员状态消息
- `NC_DEBUG`：值为 `1` 时启用调试日志

### 配置直播监控

编辑根目录的 `nana.config.yaml`。只有 `live: true` 的条目会启动监控：

```yaml
up:
  - dynamic: false
    dynamicMonitorConfig: {}
    live: true
    liveMonitorConfig:
      enableNotify: true
      notifyGroups:
        - 123456789
      messageTemplate:
        start: "{uname}播了 http://live.bilibili.com/{roomId}"
    uid: 145149047
    liveRoomId: 4629447
    uname: 饭总
```

配置字段：

- `live`：是否启用该主播的监控
- `uid`：Bilibili 用户 ID
- `liveRoomId`：Bilibili 直播间 ID
- `uname`：主播名称
- `liveMonitorConfig.enableNotify`：是否向 QQ 群发送通知
- `liveMonitorConfig.notifyGroups`：通知目标群号列表
- `liveMonitorConfig.messageTemplate.start`：开播通知文案，可使用 `{uname}` 和 `{roomId}` 占位符
- 下播文案当前由应用自动生成为 `{uname} 下播了`

### 构建并启动

构建 bot 及其 workspace 依赖：

```bash
pnpm build:bot
```

构建产物位于 `apps/bot/dist/index.mjs`。手动启动：

```bash
node apps/bot/dist/index.mjs
```

也可以使用 PM2：

```bash
pnpm pm2:start
```

PM2 的工作目录是 `apps/bot`。使用 PM2 时，将运行时环境变量放在 `apps/bot/.env`，或通过 PM2/系统环境注入。

## 开发与测试

bot 开发模式：

```bash
pnpm --filter @nana/bot dev
```

运行 bot 测试：

```bash
pnpm --filter @nana/bot test
```

运行全部 workspace 检查和测试：

```bash
vp check
vp test
```

单个 package 也提供 `build`、`dev`、`test` 和 `check` 脚本，例如：

```bash
pnpm --filter @nana/monitor check
```

## 项目结构

```text
apps/
  bot/                 # 可运行的 NanaBot 应用
    src/core/          # 应用生命周期、事件和 feature 注册
    src/monitor/       # 直播监控 feature 及 NapCat/status sinks
packages/
  bilibili-api/        # Bilibili API 类型与接口
  constants/           # 各子项目共享的公共常量
  config/              # nana.config.yaml 读写
  monitor/             # 直播监控 source、controller 和事件类型
  storage/             # db/ 下的 YAML 与 SQLite 存储
  utils/               # 通用工具
nana.config.yaml       # 直播监控配置
db/                    # 运行时数据目录（live-status.sqlite）
ecosystem.config.cjs   # PM2 入口配置
```

## PM2 管理

```bash
pnpm pm2:start
pnpm pm2:restart
pnpm pm2:stop
pnpm pm2:delete
```
