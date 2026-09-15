# 变更文档（概览）

本目录记录 NanaBotV2 的每次功能性改动，按「概览 → 明细」两级组织：

- **本文件（概览）**：只看这里就能知道「改了什么、为什么改、影响哪里、怎么验证」，再按需点进具体条目。
- **明细文档**：`NNNN-<主题>.md`，一次改动一篇，写清背景、文件级变更、关键决策与取舍、兼容性、验证方式。

## 索引

| 编号                                        | 主题                                 | 影响范围                                      | 状态   |
| ------------------------------------------- | ------------------------------------ | --------------------------------------------- | ------ |
| [0001](./0001-push-activity-aggregation.md) | 推送活动合并（同一次直播合并为一条） | `apps/site`：接口 + 面板卡片 + 共享合并逻辑   | 已完成 |
| [0002](./0002-push-activity-page.md)        | 推送活动独立页面 `/pushes`           | `apps/site`：新页面 + 列表项组件 + 侧边栏导航 | 已完成 |
| [0003](./0003-layout-and-header.md)         | 页面外壳与顶栏抽取                   | `apps/site`：layout + `AppHeader` + 刷新按钮  | 已完成 |

新增改动时：复制 [TEMPLATE.md](./TEMPLATE.md) 为 `NNNN-<主题>.md`（编号递增），写完在上表补一行。

## 这批改动解决了什么

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
