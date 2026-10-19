# 0005 推送送达状态纠偏与推送 UI 优化

- **状态**：已完成
- **日期**：2026-10-19
- **影响范围**：`apps/site`（共享 DTO / 合并口径 / 展示辅助 / 接口 / `PushActivityItem` / `PushLogCard` / `/pushes`）
- **关联需求**：截图里一条「已送达」的活动右边挂着「2 失败」，用户质疑「这种状态应该并不是失败吧」；要求排查 Web 端推送相关功能，并对推送相关 UI 与功能做优化
- **关联条目**：[上一条 0004](./0004-napcat-connection-watchdog.md) · [0001 合并规则](./0001-push-activity-aggregation.md) · [0002 活动页](./0002-push-activity-page.md) · [返回概览](./README.md)

## 现象与根因

截图中同一行同时出现两个结论：群明细写「已送达」，右侧活动徽标写「2 失败」。用户判断「这应该不是失败」，是对的。

根因（L2 逻辑层，单一 owner）：`buildPushActivities.toActivity()` 的失败数是**原始记录条数**统计出来的。

```ts
const failureCount = items.filter((item) => !item.success).length;
```

而群明细 `collectTargets()` 是**按群取最新一条**。两条口径不一致，于是：

1. 同一个群先失败、后重试成功（或 `live.start` 与下播等同一场直播的多条推送里夹杂失败记录）时，`targets` 显示「已送达」，`failureCount` 仍然 ≥ 1 → 出现「已送达 + 2 失败」；
2. `statusLabel` 优先看 `failureCount`，所以「5 个群全部送达」的活动也会被标成红色「N 失败」，左侧时间轴圆点同样变红；
3. `failureCount` 还喂给面板摘要与 `/pushes` 的统计，失败数会被系统性地放大。

bot 侧写入逻辑没有问题：`NapcatPushClient.sendGroupMsg` 每次发送都如实记一条成功/失败（`apps/bot/src/core/napcat.ts`），所以「同一群有多条记录」是真实存在的形态，展示层必须按群聚合，而不是数记录。

另外三处同源问题（同一「失败口径」owner）：

- **机器人上下线 / 通知也会被算进失败统计**：它们 `subject` 为空，不会并进开播活动，但和开播活动同处一条时间轴、同样带「失败 / 已送达」徽标。用户截图里的「上线 / 我来了~」就是一个例证：它本身送达了，却因为旧口径在同屏的开播活动上标出「2 失败」，看起来像是这条推送失败了。
- **每条管理员推送占一行**：上线 / 失败通知 / 词云等单目标推送与开播通知视觉层级相同，把真正需要关注的群送达结果挤掉了。
- **失败后的重试不可见**：即使最终送达，也看不出「曾经失败过、重试后成功」。

## 变更内容

| 文件                                            | 类型 | 说明                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/site/shared/push-log.ts`                  | 修改 | `PushActivityTarget` 增加 `attemptCount` / `failedAttemptCount` / `status: "delivered" \| "failed" \| "pending"`；`PushActivity` 改为 `targetCount` / `successCount` / `failureCount` / `pendingTargetCount` / `retryCount`；新增 `PushActivitySummary` / `PushActivityFailure`；`PushLogResponse` 增加 `generatedAt`。 |
| `apps/site/shared/push-activity.ts`             | 修改 | 失败数改为「按群最终状态」统计（`successCount + failureCount + pendingTargetCount === targetCount`）；新增 `PUSH_PENDING_WINDOW_MS`（60s）与 `aggregatablePurposes`；新增 `getPushActivityTone`、`summarizePushActivities`、`collectPushActivityFailures`。                                                             |
| `apps/site/shared/push-presentation.ts`         | 新增 | 展示口径收口：状态文案 / 颜色（`PUSH_STATUS_LABELS`、`PUSH_STATUS_CHIP_CLASS`、`PUSH_STATUS_DOT_CLASS`）、`getActivityStatusView`、`getTargetStatusView`、`summarizeTargets`。                                                                                                                                          |
| `apps/site/server/api/push-log.get.ts`          | 修改 | 返回值补 `generatedAt`，页面不再依赖客户端时间判断新鲜度。                                                                                                                                                                                                                                                              |
| `apps/site/app/components/PushActivityItem.vue` | 修改 | 徽标 / 圆点 / 群明细统一走 `push-presentation`；「重试 n」与「重试后送达」；群明细展示每个群的最终结果 + 重试说明；`highlight` 属性给需要处理的活动加背景；隐藏空内容行；标题去掉「开播 开播」重复。                                                                                                                    |
| `apps/site/app/components/PushLogCard.vue`      | 修改 | 顶部摘要徽标（`3 个群未送达` / `n 个群待确认` / `全部送达`）；失败优先高亮；「还有 n 条更早的活动」入口。                                                                                                                                                                                                               |
| `apps/site/app/pages/pushes.vue`                | 修改 | 统计卡（活动 / 未送达的群 / 待确认的群）+「需要处理」失败明细 + 全部/未送达/待确认筛选（默认视图随数据切换）；列表项与筛选共用同一份去重口径。                                                                                                                                                                          |
| `apps/site/tests/push-activity.test.ts`         | 修改 | 用例从 6 个扩到 12 个，覆盖重试后送达、部分群失败、待确认窗口、机器人上线活动、汇总口径、失败明细。                                                                                                                                                                                                                     |

## 口径变化（关键决策）

1. **成败只看每个群最后一次推送**。`targetCount` 是群数，不是记录数；重试后送达的群算成功。原始记录一条都不删，仍在 `items` / `targets.attemptCount` 里可查。
2. **失败 → 待确认（60s 观察窗口）**。失败且距今不足 `PUSH_PENDING_WINDOW_MS` 的群标记 `pending`，展示为橙色「待确认」，不计入失败；超过窗口仍是失败才展示红色「未送达」。极端翻页场景下 `pushed_at` 可能略晚于服务器时间，窗口也不会因此误报。
3. **只有开播 / 下播参与场次合并**（`aggregatablePurposes`）。机器人上下线、管理员通知、词云这类单目标推送各自成条，不再占用「某场直播」的送达统计；开播 / 下播本身就是多群广播，才是「哪个群没收到」需要排查的对象。
4. **面板与页面用同一套图标 / 颜色 / 文案**，全部来自 `push-presentation.ts`，避免第 0002 篇里「组件各写一遍迟早走偏」的老问题。
5. **默认视图看数据说话**：有未送达活动默认只看未送达；只有待确认就看待确认；全部正常则展示全部，并在筛选行右侧明示当前是「默认」视图，可一键恢复。

## 兼容性与数据安全

- `push_log` 表结构、bot 写入路径、`readPushLogs` 默认行为都未改动；历史数据天然适用新口径，无需迁移。
- `/api/push-log` 只是新增字段（`targetCount`、`pendingTargetCount`、`retryCount`、`targets[].status` 等）与 `generatedAt`，删除了合并层的 `failedTargetCount` 等重复字段；站点内外没有其它消费方引用被删字段。
- bot 与 site 可以独立升级：旧 bot + 新 site 只是没有「重试」这类新的数据形态，展示口径不受影响。

## 验证

| 验证                     | 命令 / 方式                                                                                       | 结果                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 回归可复现（改前）       | 用 `git show HEAD:` 的旧实现跑同一组数据                                                          | 旧实现：`successCount=2 failureCount=2 targets= 1:true,2:true`（「已送达」+「2 失败」复现）                                 |
| 回归用例（改后）         | `vp test push-activity`                                                                           | 12 个用例全部通过（新增「失败后重试成功不再显示失败」「仍有群没收到只统计真正失败的群」「待确认窗口」「上线活动不误判」等） |
| 格式化 / lint / 类型检查 | `vp check`                                                                                        | 0 error；warning 均来自既有的 `packages/monitor/tests/monitor.test.ts`                                                      |
| 全量单测                 | `vp test`                                                                                         | 29 个测试文件、167 用例通过（1 跳过）                                                                                       |
| 生产构建                 | `pnpm --filter @nana/site build`                                                                  | 通过                                                                                                                        |
| 接口（截图同构数据）     | 17 条原始记录：6 群一场（含 2 条失败后重试成功）、1 个真失败群、1 条待确认、机器人上线+旧失败记录 | `饭总` 活动 `targetCount=5 successCount=5 failureCount=0 retryCount=2`；机器人上线活动 `ok=1 fail=0`                        |
| SSR 渲染                 | 构建产物 SSR 后按 `aria-pressed` / 文本断言                                                       | 默认视图：有失败 → 「未送达」，只有待确认 → 「待确认」，全部正常 → 「全部」                                                 |
| 视觉检查                 | headless Edge 截图 `/` 与 `/pushes`                                                               | 面板显示「3 个群未送达」摘要、失败活动高亮、「我来了~」显示「已送达」、「5 群全部送达 + 重试后送达」同屏消歧                |

## 未决事项 / 后续可选项

- **合并仍是启发式**（`subject` + 30 分钟窗口），精确到场次需要 bot 写入 `room_id` / 会话 ID 并给 `push_log` 补列，见 [0001](./0001-push-activity-aggregation.md#后续可选项)。
- **没有「重发」动作**：失败明细目前只读；若需要一键重推，得在 bot 侧提供受控的重发接口（含幂等键），site 只负责触发。
- **`/pushes` 仍未分页**，窗口截断时最旧活动被丢弃（见 [0001](./0001-push-activity-aggregation.md#接口契约)）。
- **错误原因未归类**：当前只展示 NapCat 原始错误文本，没有按「连接断开 / 超时 / 权限」归一，需要时再在 bot 侧按错误码分类。
