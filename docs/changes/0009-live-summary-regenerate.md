# 0009 直播摘要重新生成

- **状态**：已完成
- **日期**：2026-11-12
- **影响范围**：`apps/site` + `packages/storage` + `packages/live-summary`
- **关联需求**：站点直播摘要需要一个可用于测试的重新生成入口，并且入口可以随时隐藏。
- **关联条目**：[上一条](./0008-live-summary-full-session.md) · [返回概览](./README.md)

## 背景

摘要一旦写入 `ok`，`claimLiveSummary` 就会直接返回已有正文，页面也没有覆盖入口。
调提示词或摘录策略后，只能用旧场次反复清库才能验证；需要一个显式、可控的重算入口。

## 变更内容

| 文件                                              | 类型 | 说明                                                                |
| ------------------------------------------------- | ---- | ------------------------------------------------------------------- |
| `packages/storage/src/danmu.ts`                   | 修改 | `claimLiveSummary` 支持 `force`，允许覆盖已有 `ok` / `empty` 摘要。 |
| `packages/live-summary/src/generate.ts`           | 修改 | `settleLiveSummary` 透传 `force`，页面来源仍不会发群。              |
| `apps/site/server/api/danmu/[id]/summary.post.ts` | 修改 | 支持 `?regenerate=1` 强制重算。                                     |
| `apps/site/server/utils/liveSummary.ts`           | 修改 | 页面摘要请求支持 `force` 选项。                                     |
| `apps/site/app/components/DanmuLiveSummary.vue`   | 修改 | 成功摘要旁新增「重新生成」，可隐藏；隐藏后保留「···」恢复入口。     |
| `packages/storage/tests/live-summary.test.ts`     | 修改 | 覆盖强制认领与「不抢占正在生成任务」。                              |
| `packages/live-summary/tests/summary.test.ts`     | 修改 | 覆盖 force 重新调用模型并覆盖旧正文。                               |

## 关键决策与取舍

- **`force` 放在存储认领层**：重算也必须经过认领，两个请求同时点「重新生成」时只有一个能调用模型。
- **`force` 不覆盖新鲜的 `pending`**：只允许覆盖已完成的 `ok` / `empty`，正在生成的场次仍返回 busy。
- **页面来源保持 `site`**：重新生成只更新面板与数据库正文，不触发 QQ 群推送，也不影响机器人补发队列。
- **隐藏状态放 Cookie**：Nuxt SSR 也能读到，避免先显示再隐藏的闪烁；默认显示，按浏览器记忆。

## 兼容性与数据安全

- `?regenerate=1` 是可选参数，原接口行为不变；数据库结构不变。
- 强制重算会覆盖旧正文，但原始弹幕仍完整保留，可以继续重算。
- 页面没有任何鉴权，`?regenerate=1` 会带来额外的模型调用成本；当前仅适合内网/自用面板。

## 验证

| 验证                   | 命令 / 方式                                                                                       | 结果            |
| ---------------------- | ------------------------------------------------------------------------------------------------- | --------------- |
| 存储与摘要测试         | `vp test packages/storage/tests/live-summary.test.ts packages/live-summary/tests/summary.test.ts` | 通过：15 个用例 |
| 格式化、lint、类型检查 | `vp check packages/storage packages/live-summary apps/site`                                       | 通过：0 error   |
| 站点构建               | `vp run @nana/site#build`                                                                         | 通过            |

## 未决事项 / 后续可选项

- 如果面板暴露到公网，应给强制重算加管理鉴权或仅在生产环境隐藏入口。
