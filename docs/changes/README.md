# 变更文档（概览）

本目录记录 NanaBotV2 的每次功能性改动，按「概览 → 明细」两级组织：

- **本文件（概览）**：只看这里就能知道「改了什么、为什么改、影响哪里、怎么验证」，再按需点进具体条目。
- **明细文档**：`NNNN-<主题>.md`，一次改动一篇，写清背景、文件级变更、关键决策与取舍、兼容性、验证方式。

## 索引

| 编号                                         | 主题                                  | 影响范围                                                      | 状态   |
| -------------------------------------------- | ------------------------------------- | ------------------------------------------------------------- | ------ |
| [0001](./0001-push-activity-aggregation.md)  | 推送活动合并（同一次直播合并为一条）  | `apps/site`：接口 + 面板卡片 + 共享合并逻辑                   | 已完成 |
| [0002](./0002-push-activity-page.md)         | 推送活动独立页面 `/pushes`            | `apps/site`：新页面 + 列表项组件 + 侧边栏导航                 | 已完成 |
| [0003](./0003-layout-and-header.md)          | 页面外壳与顶栏抽取                    | `apps/site`：layout + `AppHeader` + 刷新按钮                  | 已完成 |
| [0004](./0004-napcat-connection-watchdog.md) | NapCat 连接看门狗（断线不再需要重启） | `apps/bot`：`core` 看门狗 + 入口重连配置 + 测试 + 诊断脚本    | 已完成 |
| [0005](./0005-push-status-and-ui.md)         | 推送送达状态纠偏与推送 UI 优化        | `apps/site`：合并口径 + 展示辅助 + 面板 / 活动页              | 已完成 |
| [0006](./0006-multi-napcat-accounts.md)      | 多 QQ 号（多个 NapCat 实例）          | `apps/bot` + `packages/storage`：账号配置、连接编排、推送记录 | 已完成 |
| [0007](./0007-bot-file-logs.md)              | Bot 文件日志与按账号拆分              | `apps/bot`：日志组件、账号级日志接入、入口装配                | 已完成 |
| [0008](./0008-live-summary-full-session.md)  | 直播摘要覆盖整场弹幕                  | `packages/live-summary`：摘录抽样 + 提示词 + 回归测试         | 已完成 |
| [0009](./0009-mixed-qq-accounts.md)          | 官方 / NapCat 混合账号与配置统一      | `apps/bot`、`apps/site`、配置、官方通信与群发现存储           | 已完成 |
| [0010](./0010-site-qq-test-messages.md)      | site QQ 普通消息与 @全体测试          | `apps/site`、共享环境变量读取、测试推送记录                   | 已完成 |
| [0011](./0011-site-mobile-navigation.md)     | site 移动端导航抽屉                   | `apps/site`：布局、顶栏、侧边栏、导航状态                     | 已完成 |

新增改动时：复制 [TEMPLATE.md](./TEMPLATE.md) 为 `NNNN-<主题>.md`（编号递增），写完在上表补一行。

## 0001–0003 这批改动解决了什么

需求原文：网页端的推送活动展示逻辑要改——同一主播同一次直播产生的多条推送合并为一条、面板页最多展示 5 条、点「查看全部」跳到独立页面，且原始推送数据不能因为展示合并而丢失。

改动前 → 改动后：

| 维度         | 改动前                                                    | 改动后                                                                     |
| ------------ | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| 展示粒度     | 一行 = 一次群推送；饭总配了 6 个通知群，一次开播就是 6 行 | 一条活动 = 一次直播；6 个群的推送合并成 1 条，并显示群数与成功/失败计数    |
| 面板条数     | 接口固定取 20 条原始记录（约等于 3 场直播）               | 面板最多展示 5 条活动（`PUSH_ACTIVITY_PANEL_LIMIT`）                       |
| 「查看全部」 | 在卡片里就地展开/收起，最多 20 条原始记录                 | 跳转独立页面 `/pushes`，展示全部活动并展开每个群的送达明细                 |
| 原始数据     | 面板直接渲染原始行                                        | 原始行照旧全量落库、接口照旧返回 `logs`，合并结果内保留 `items` 原始记录   |
| 页面结构     | 单个页面，header 内联在 `index.vue`，侧边栏导航全是死链   | `layouts/default.vue` 承载外壳，`AppHeader` 组件承担顶栏，导航改为真实路由 |

## 受影响的文件

新增：

- [`apps/site/shared/push-log.ts`](../../apps/site/shared/push-log.ts)：推送 DTO（`PushLogItem` / `PushActivity` / `PushLogResponse`）与 `toPushLogItem`。
- [`apps/site/shared/push-activity.ts`](../../apps/site/shared/push-activity.ts)：合并纯函数 `buildPushActivities` 与相关常量。
- [`apps/site/tests/push-activity.test.ts`](../../apps/site/tests/push-activity.test.ts)：合并逻辑单测（6 个用例）。
- [`apps/site/app/pages/pushes.vue`](../../apps/site/app/pages/pushes.vue)：推送活动独立页面。
- [`apps/site/app/components/PushActivityItem.vue`](../../apps/site/app/components/PushActivityItem.vue)：时间轴单条活动（面板与独立页共用）。
- [`apps/site/app/layouts/default.vue`](../../apps/site/app/layouts/default.vue)：侧边栏 + 主列外壳。
- [`apps/site/app/components/AppHeader.vue`](../../apps/site/app/components/AppHeader.vue)：顶栏（面包屑 + 插槽）。
- [`apps/site/app/components/AppRefreshButton.vue`](../../apps/site/app/components/AppRefreshButton.vue)：刷新按钮。

修改：

- [`apps/site/server/api/push-log.get.ts`](../../apps/site/server/api/push-log.get.ts)：读取窗口、合并、返回 `{ logs, activities, truncated }`。
- [`apps/site/app/components/PushLogCard.vue`](../../apps/site/app/components/PushLogCard.vue)：渲染活动、限制 5 条、「查看全部」改为跳转。
- [`apps/site/app/pages/index.vue`](../../apps/site/app/pages/index.vue)：接入布局与 `AppHeader`，右侧卡片消费 `activities`。
- [`apps/site/app/components/AppSidebar.vue`](../../apps/site/app/components/AppSidebar.vue)：概览 / 推送活动改为 `NuxtLink` 并按路由高亮。
- [`apps/site/app/app.vue`](../../apps/site/app/app.vue) / [`apps/site/app/types.ts`](../../apps/site/app/types.ts)：布局接入、类型 barrel 与 `HeaderTrailItem`。
- [`apps/site/README.md`](../../apps/site/README.md)：目录结构、合并规则、顶栏说明。

未改动（有意为之）：`packages/*`（含 `@nana/storage` 的表结构与读写）与 `apps/bot` 的推送写入逻辑；`db/push-log.sqlite` 结构不变，历史数据不需要迁移。

## 验证摘要

| 验证                       | 命令 / 方式                       | 结果                                                                                         |
| -------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| 格式化、lint、类型检查     | `vp check`                        | 通过：134 个文件格式正确，103 个文件无 warning / lint / type 错误                            |
| 单元测试                   | `vp test`                         | 通过：16 个测试文件、59 个用例（其中新增 `push-activity` 6 个用例）                          |
| 生产构建                   | `pnpm build:site`                 | 通过：产出包含 `pushes` 页面与 `api/push-log` 路由 chunk                                     |
| SSR 端到端（含合并正确性） | 构建产物 + 临时灌入 13 条推送记录 | 接口返回 `activities=7 logs=13 truncated=False`；面板 SSR 恰好 5 条活动、`/pushes` 渲染 7 条 |
| 顶栏抽取回归               | 构建产物 SSR 输出对比             | 两个页面各 1 个 header，面包屑 / 状态 / 搜索 / 刷新按钮按预期出现                            |

## 未决事项 / 后续可选项

- **合并依据是启发式**：推送记录里没有直播场次字段，现在用「`subject` + 相邻推送间隔（默认 30 分钟）」推断。若要 100% 精确，需要 bot 写入时带上 `room_id`（或 `session_id`）并给 `push_log` 补列，前端合并函数可保持不变。详见 [0001](./0001-push-activity-aggregation.md#后续可选项)。
- **窗口截断**：`GET /api/push-log` 默认读 500 条原始记录（`?rawLimit=` 可调，上限 2000），截断时最旧的一条活动会被丢弃。数据量再涨需要考虑真正分页。
- **站点自带 `nuxt typecheck` 跑不起来**：仓库未安装 `vue-tsc` / `golar`（既有情况，本次按要求未新增依赖），类型安全由 `vp check` 的类型检查覆盖。

## 0004 NapCat 连接看门狗解决了什么

需求原文：NapCat 里登录的 QQ 掉线后邮件通知正常，但重新登录 QQ 之后 bot 不会自己连回来，必须重启才行；希望不用重启，否则至少要有一个不登服务器就能恢复的办法。

- **为什么改**：`node-napcat-ts@0.4.25` 的重连是「有预算、一次性」的——原来的 `attempts: 10, delay: 5000` 只覆盖约 45 秒，NapCat 重启 + QQ 重登远超这个窗口；预算耗尽后库永久停止重连，而且此时 `connect()` 既不报错也不重连（返回的 Promise 永不 settle）。库还会在收到 `{status:"failed",echo:null}` 时永久关掉自动重连。四条失效路径都用探针复现了，详见 [0004](./0004-napcat-connection-watchdog.md#现象与根因)。
- **改了什么**：[`apps/bot/src/core/connection.ts`](../../apps/bot/src/core/connection.ts) 新增 `ConnectionSupervisor`：断开后 20 秒内没有任何重连活动就强制 `reconnect()`；自称已连接但 60 秒收不到任何 NapCat 事件就用 `get_status()` 探活（治 TCP 半开）。`attempts` 改为无限，库的重试当快路径、看门狗当兜底；首次连接加 15 秒超时，不再把启动挂死。顺带修掉长期离线的三个副作用：连接类日志按 5 分钟节流（原来每 5 秒两行、约 3~4 MB/天）、[`apps/bot/src/offline/feature.ts`](../../apps/bot/src/offline/feature.ts) 的恢复判定改为「以心跳为准」（不再出现「QQ 还离线却发恢复邮件」来回刷）、QQ 离线时看门狗完全不空转。
- **影响哪里**：仅 `apps/bot`（`src/core`、`src/offline`、入口重连配置、`test/`、`scripts/`）；`@nana/site` 与 `packages/*` 未改，无数据结构变化。
- **怎么验证**：`vp check`（145 文件格式正确、108 文件无 warning/lint/type 错误）、`vp test`（18 文件 75 用例，新增看门狗 12 个 + 离线告警 4 个）、`pnpm --filter @nana/bot probe:reconnect`（真实 WS 服务器端到端验证：掐断 NapCat 后看门狗自动连回，无需重启进程）。部署用 `pnpm app deploy bot`。
- **还没解决**：要「手机点一下就重启 bot」仍需一个独立于 bot 的进程（面板 API）来代劳，本次未实现；QQ 群指令自救不可行（bot 掉线时收不到消息）。另外长时间离线期间开播通知会丢且不补发（需要落库补发队列），详见 [0004](./0004-napcat-connection-watchdog.md#未决事项--后续可选项)。
