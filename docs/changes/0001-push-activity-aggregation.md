# 0001 推送活动合并（同一次直播合并为一条）

- **状态**：已完成
- **日期**：2026-09-15
- **影响范围**：`apps/site`（服务端接口 + 面板卡片 + 共享 DTO / 合并逻辑）
- **关联需求**：面板里同一个主播在同一次直播产生的多条推送要合并成一条；面板页最多 5 条；原始推送数据不能因为展示合并而丢失
- **关联条目**：[下一条 0002](./0002-push-activity-page.md) · [返回概览](./README.md)

## 背景

`db/push-log.sqlite` 的每一行是「一次群推送」。饭总在 `nana.config.yaml` 里配了 6 个通知群，所以一次开播就会写 6 条 `purpose = "live.start"`、`subject = "饭总"` 的记录，`pushedAt` 只相差几毫秒；某个群发送失败时还会多一条 `subject` 为空的管理员通知。

这带来两个问题：

1. 面板接口原本固定 `readPushLogs({}, 20)`，20 条原始记录实际上只代表约 3 场直播，信息密度极低；
2. 一场直播的 6 条推送在时间轴上重复展示，看不出「这是一次开播」。

同时约束是不能丢原始数据：后续排查「哪个群没收到」仍然需要每条群推送的成功 / 失败与错误信息。

## 变更内容

| 文件                                       | 类型 | 说明                                                                                                                                                                             |
| ------------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/site/shared/push-log.ts`             | 新增 | 推送 DTO：`PushLogItem`、`PushActivity`、`PushActivityTarget`、`PushLogResponse`，以及 `toPushLogItem` 映射。服务端与前端共用同一套类型。                                        |
| `apps/site/shared/push-activity.ts`        | 新增 | 合并纯函数 `buildPushActivities`，以及 `PUSH_ACTIVITY_PANEL_LIMIT = 5`、`PUSH_ACTIVITY_RAW_LIMIT = 500`、`PUSH_ACTIVITY_RAW_LIMIT_MAX = 2000`、`PUSH_SESSION_GAP_MS = 30 分钟`。 |
| `apps/site/server/api/push-log.get.ts`     | 修改 | 读取窗口从 20 改成可配置（默认 500，最多 2000），多读一条判断截断，返回 `{ logs, activities, truncated }`。                                                                      |
| `apps/site/app/components/PushLogCard.vue` | 修改 | 渲染合并后的活动，默认 `slice(0, 5)`；「查看全部」由就地展开改为跳转 `/pushes`。                                                                                                 |
| `apps/site/app/pages/index.vue`            | 修改 | 右侧卡片改为传入 `pushData.activities`。                                                                                                                                         |
| `apps/site/app/types.ts`                   | 修改 | 类型移到 `shared/`，这里保留 barrel 再导出，既有 `~/types` 引用不受影响。                                                                                                        |
| `apps/site/tests/push-activity.test.ts`    | 新增 | 6 个用例覆盖合并、拆分、阈值、失败计数、同群重复、无主播名推送。                                                                                                                 |

## 合并规则

推送记录里**没有**直播场次字段（表结构为 `id, target_id, target, purpose, purpose_label, pushed_at, success, error, content, subject`），所以合并是展示层的启发式规则：

1. 按 `subject`（主播名）分组；`subject` 为空或空串的记录不参与合并，各自作为一条活动保留（管理员失败通知、上下线提示），避免合并时吞数据。
2. 同一主播的记录按 `pushedAt`（相同则按 `id`）升序，相邻两条间隔超过 `PUSH_SESSION_GAP_MS` 就切分成新的一次直播。
3. 每条活动的字段：`subject`、`purpose` / `purposeLabel`（优先取该场直播里的 `live.start` 记录）、`startedAt` / `latestAt`、`content`（最新的非空摘要）、`targets`（按群聚合，同群重复推送保留最新一条）、`successCount` / `failureCount`、`items`（全部原始记录）。
4. 活动按 `latestAt` 倒序返回，`id` 形如 `饭总#12`（`subject#最早一条原始记录的 id`），可直接用作列表 key。

为什么不用 `content` 当键：默认模板 `{uname} 播了 http://live.bilibili.com/{roomId}` 每次开播的文本完全一样，无法区分两场直播。`content` 只作为辅助信息展示。

## 接口契约

```http
GET /api/push-log?rawLimit=500
```

```jsonc
{
  "logs": [/* 原始记录，按 pushed_at DESC, id DESC */],
  "activities": [
    {
      "id": "饭总#1",
      "subject": "饭总",
      "purpose": "live.start",
      "purposeLabel": "开播",
      "startedAt": "2026-09-15T10:00:00.000Z",
      "latestAt": "2026-09-15T10:00:00.080Z",
      "content": "饭总播了 http://live.bilibili.com/4629447",
      "targets": [
        {
          "targetId": "1101365727",
          "target": "饭友群",
          "success": true,
          "error": null,
          "pushedAt": "...",
        },
      ],
      "successCount": 2,
      "failureCount": 1,
      "items": [/* 该场直播的全部原始记录 */],
    },
  ],
  "truncated": false,
}
```

| 参数 / 字段  | 语义                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `?rawLimit=` | 原始记录读取窗口，非整数或 ≤ 0 时回退默认 500，超过 2000 时按 2000 处理                                                               |
| `logs`       | 原始记录，保证前端与其它消费方仍能拿到未经合并的数据                                                                                  |
| `activities` | 合并后的活动，倒序                                                                                                                    |
| `truncated`  | 窗口被截断（数据库里还有更早的记录）。此时最旧的一条活动可能只包含该场直播的部分推送，服务端会直接丢弃它，`activities` 只保留完整活动 |

## 关键决策与取舍

- **放 `shared/` 而不是 `@nana/storage` 或新 package**：合并是展示逻辑，只有站点用；`@nana/storage` 的职责是 SQLite 读写，bot 也不需要这份聚合。`shared/` 同时能被 Nitro 服务端与 Vue 前端引用，且不依赖 Vue / Nitro API，可以按相对路径直接做单测。
- **在服务端合并而不是组件里合并**：面板与独立页要用同一份规则，SSR 时算一次即可；组件里各写一遍迟早会走偏。
- **保留 `logs` 且活动内嵌 `items`**：既是「原始数据不丢」的硬要求，也让独立页面可以展开每个群的送达明细。
- **窗口从 20 提到 500**：6 个群 / 场意味着 20 条原始记录只有约 3 场直播，凑不满面板的 5 条；500 条约等于 80 场直播。
- **不做表结构迁移**：现有字段足以做展示层合并，历史数据天然适用。精确到场次需要 bot 侧配合（见下）。

## 兼容性与数据安全

- 未修改 `packages/*` 与 `apps/bot`，`push_log` 表结构、写入路径、`db/push-log.sqlite` 数据都不变；bot 与 site 可以独立升级。
- `readPushLogs` 的默认 `limit = 20` 未改动，其它调用方行为不变。
- 合并结果里保留 `items`，前端仍可拿到目标群、成功 / 失败、错误信息与时间。

## 验证

| 验证                       | 命令 / 方式                                                                                                               | 结果                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 格式化、lint、类型检查     | `vp check`                                                                                                                | 通过（134 文件格式、103 文件无 warning / lint / type 错误）                              |
| 单元测试                   | `vp test`、`vp test push-activity`                                                                                        | 全量 16 文件 59 用例通过；本文件所属的 `push-activity` 6 用例通过                        |
| 合并正确性（真实数据形态） | 用 `writePushLog` 临时灌入 13 条记录（3 群一场 + 单群一场 + 4 场各 2 群 + 1 条无主播名 `app.online`），请求构建产物的接口 | `activities=7 logs=13 truncated=False`；3 群那场为 `targets=3 / ok=2 / fail=1 / items=3` |
| 面板条数                   | 同一份数据下检查 `/` 的 SSR 输出                                                                                          | 面板恰好渲染 5 条活动（7 条中取最新 5 条）                                               |
| 数据清理                   | 验证后删除临时 `db/push-log.sqlite`                                                                                       | 仓库内只剩 `db/live-status.sqlite`，生产数据未受影响                                     |

## 后续可选项

如果「同一次直播」需要 100% 精确（例如主播一天开播两次、或 bot 重启导致同一场直播再次触发 `live.started`），可以：

1. 在 `apps/bot/src/monitor/sinks/napcat.ts` 的推送参数里带上 `event.roomId`（或由 monitor 生成的会话标识），`NapcatPushClient` 透传到 `writePushLog`；
2. 按 `packages/storage/src/live-status.ts` 里 `ensureLiveStatusColumns` 的模式给 `push_log` 补列；
3. 前端把 `buildPushActivities` 的分组键从 `subject` 换成 `room_id`（老数据仍回退到当前的启发式）。

前两步都在 bot / storage 侧，属于独立改动，做的时候单独开一篇明细文档。
