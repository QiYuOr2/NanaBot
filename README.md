# NanaBot

NanaBot 是一个基于 NapCat WebSocket 的轻量机器人项目，当前内置了直播间监控能力，可在指定 Bilibili 直播间开播/下播时向 QQ 群发送通知。

它适合用于个人运营、群内提醒、直播关注等场景，也可作为一个可扩展的机器人骨架继续开发更多功能。

## ✨ 功能特性

- 连接 NapCat WebSocket 服务，接入 QQ 机器人能力
- 启动后自动向管理员群发送上线提示
- 监控指定 Bilibili 直播间的开播与下播状态
- 支持向多个 QQ 群发送通知
- 支持自定义通知文案模板
- 内置 PM2 启动脚本，适合长期运行

## 🧰 环境要求

- Node.js（建议使用最新 LTS 版本）
- pnpm
- 一个可用的 NapCat 服务实例
- 可访问的 Bilibili 直播间信息

## 🚀 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

在项目根目录创建 `.env` 文件：

```env
NC_WS_URL=ws://127.0.0.1:1111
# 可选
NC_ACCESS_TOKEN=your_access_token
ADM_GROUP=123456789
NC_DEBUG=1
```

说明：

- `NC_WS_URL`：NapCat 的 WebSocket 地址
- `NC_ACCESS_TOKEN`：如有需要可填写访问令牌
- `ADM_GROUP`：管理员群号，用于发送机器人状态通知
- `NC_DEBUG`：设置为 `1` 时启用调试日志

### 3. 配置直播监控

编辑项目根目录下的 `nana.config.yaml`，在 `up` 数组中配置直播间：

```yaml
up:
  - live: true
    liveRoomId: 4629447
    uname: 饭总
    liveMonitorConfig:
      enableNotify: true
      notifyGroups: [123456789]
      messageTemplate:
        start: "饭总播了 http://live.bilibili.com/4629447"
```

字段说明：

- `liveRoomId`：Bilibili 直播间 ID
- `uname`：主播名称
- `liveMonitorConfig.enableNotify`：是否发送直播和监控通知，默认为 `true`
- `liveMonitorConfig.notifyGroups`：接收通知的 QQ 群号列表
- `liveMonitorConfig.messageTemplate.start`：开播通知文案
- `messages.liveEnd`：下播通知文案

### 4. 构建项目

```bash
pnpm build
```

### 5. 启动项目

直接运行：

```bash
node dist/index.mjs
```

或使用 PM2：

```bash
pnpm pm2:start
```

## 🏗️ 项目结构

```text
src/
  core/           # 应用与事件基础能力
  features/       # 功能模块，例如直播监控
  lib/            # 工具函数与辅助逻辑
nana.config.yaml     # 项目统一配置
ecosystem.config.cjs           # PM2 聚合配置
apps/bot/ecosystem.config.cjs  # bot 的 PM2 配置
```

## ⚙️ 运行脚本

```bash
pnpm build
pnpm pm2:start
```

## 📝 说明

- 机器人启动后会优先连接 NapCat 服务。
- 当直播间开播时，会向配置的群发送通知，并附带 @all 提醒。
- 若监听异常，机器人会向管理员群发送告警提示。
- 配置文件支持按主播分别管理通知群和自定义文案。
