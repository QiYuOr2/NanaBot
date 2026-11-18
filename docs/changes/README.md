# 变更文档（概览）

本目录记录 NanaBotV2 的每次功能性改动，按「概览 → 明细」两级组织：

- **本文件（概览）**：只看这里就能知道「改了什么、为什么改、影响哪里、怎么验证」，再按需点进具体条目。
- **明细文档**：`NNNN-<主题>.md`，一次改动一篇，写清背景、文件级变更、关键决策与取舍、兼容性、验证方式。

## 索引

| 编号                                          | 主题                                  | 影响范围                                                                                    | 状态   |
| --------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------- | ------ |
| [0001](./0001-push-activity-aggregation.md)   | 推送活动合并（同一次直播合并为一条）  | `apps/site`：接口 + 面板卡片 + 共享合并逻辑                                                 | 已完成 |
| [0002](./0002-push-activity-page.md)          | 推送活动独立页面 `/pushes`            | `apps/site`：新页面 + 列表项组件 + 侧边栏导航                                               | 已完成 |
| [0003](./0003-layout-and-header.md)           | 页面外壳与顶栏抽取                    | `apps/site`：layout + `AppHeader` + 刷新按钮                                                | 已完成 |
| [0004](./0004-napcat-connection-watchdog.md)  | NapCat 连接看门狗（断线不再需要重启） | `apps/bot`：`core` 看门狗 + 入口重连配置 + 测试 + 诊断脚本                                  | 已完成 |
| [0005](./0005-push-status-and-ui.md)          | 推送送达状态纠偏与推送 UI 优化        | `apps/site`：合并口径 + 展示辅助 + 面板 / 活动页                                            | 已完成 |
| [0006](./0006-multi-napcat-accounts.md)       | 多 QQ 号（多个 NapCat 实例）          | `apps/bot` + `packages/storage`：账号配置、连接编排、推送记录                               | 已完成 |
| [0007](./0007-bot-file-logs.md)               | Bot 文件日志与按账号拆分              | `apps/bot`：日志组件、账号级日志接入、入口装配                                              | 已完成 |
| [0008](./0008-live-summary-full-session.md)   | 直播摘要覆盖整场弹幕                  | `packages/live-summary`：摘录抽样 + 提示词 + 回归测试                                       | 已完成 |
| [0009](./0009-mixed-qq-accounts.md)           | 官方 / NapCat 混合账号与配置统一      | `apps/bot`、`apps/site`、配置、官方通信与群发现存储                                         | 已完成 |
| [0010](./0010-site-qq-test-messages.md)       | site QQ 普通消息与 @全体测试          | `apps/site`、共享环境变量读取、测试推送记录                                                 | 已完成 |
| [0011](./0011-site-mobile-navigation.md)      | site 移动端导航抽屉                   | `apps/site`：布局、顶栏、侧边栏、导航状态                                                   | 已完成 |
| [0012](./0012-site-tests-via-bot-control.md)  | site 测试消息改走 bot 控制接口        | `apps/bot`、`apps/site`：运行中账号发送与内部控制接口                                       | 已完成 |
| [0013](./0013-low-memory-deploy.md)           | 低内存部署选项                        | `scripts/app.mjs`：构建前停止应用、失败恢复                                                 | 已完成 |
| [0014](./0014-site-ci-build.md)               | Site Linux CI 构建与产物部署          | GitHub Actions、部署脚本：服务器不再构建 site                                               | 已完成 |
| [0015](./0015-operations-and-project-auth.md) | 运维面板、项目鉴权与账号控制          | site、bot、共享配置、CI：日志 / 系统状态、统一登录、提醒模板、NapCat 开关                   | 已完成 |
| [0016](./0016-site-deploy-target.md)          | 修正 Site CI 部署目录                 | 部署脚本、CI：按 PM2 启动路径切换产物、端口解析和部署回归验证                               | 已完成 |
| [0017](./0017-site-log-tags-and-scroll.md)    | Site 日志标签化与最新日志定位         | `apps/site`：日志三段标签配色、解析单测、默认滚动到最新日志                                 | 已完成 |
| [0018](./0018-bilibili-dynamic-monitor.md)    | Bilibili UP 主动态监控与推送          | `bilibili-api`、`storage`、`constants`、`apps/bot`：动态 API、轮询调度、去重持久化、QQ 推送 | 已完成 |

新增改动时：复制 [TEMPLATE.md](./TEMPLATE.md) 为 `NNNN-<主题>.md`（编号递增），写完在上表补一行。
