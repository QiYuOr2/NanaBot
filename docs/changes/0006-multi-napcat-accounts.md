# 0006 多 QQ 号（多 NapCat 实例）

- **状态**：已完成
- **日期**：2026-11-11
- **影响范围**：`apps/bot` / `packages/storage` / 配置与文档
- **关联需求**：当前配置只支持一个 QQ 号，希望同一个 bot 进程处理两个 NapCat 实例。
- **关联条目**：[上一条](./0005-push-status-and-ui.md) · [返回概览](./README.md)

## 背景

一个 NapCat 实例只能登录一个 QQ 号，因此两个 QQ 号必然对应两个 WebSocket 端口。改动前
`apps/bot/src/index.ts` 只创建一个 `App`（一个 `NCWebsocket`），所有功能共享同一个连接；
`NC_WS_URL` / `NC_ACCESS_TOKEN` 也只能表达一套连接信息。

## 变更内容

| 文件                                           | 类型 | 说明                                                                  |
| ---------------------------------------------- | ---- | --------------------------------------------------------------------- |
| `apps/bot/src/accounts.ts`                     | 新增 | 解析 `napcat.accounts`，回退旧版单账号环境变量，并按 `qqAccount` 分组 |
| `apps/bot/src/index.ts`                        | 修改 | 每个账号创建一个 `App`，并行启动并在进程级统一处理退出信号            |
| `apps/bot/src/monitor/config.ts`               | 修改 | `up[]` 新增可选 `qqAccount`                                           |
| `apps/bot/src/core/createApp.ts`               | 修改 | 支持账号元数据、`handleSignals` 开关，推送客户端带上账号 id           |
| `apps/bot/src/core/napcat.ts`                  | 修改 | 推送记录写入 `account`                                                |
| `packages/storage/src/push-log.ts`             | 修改 | `push_log` 新增 `account` 列，旧库打开时自动补列                      |
| `packages/storage/src/app-state.ts`            | 修改 | 非首个账号使用独立 `app-state-<id>.sqlite`，避免离线状态互相覆盖      |
| `apps/bot/src/summary/publish.ts`              | 修改 | 补发摘要支持 `roomIds` 过滤，按账号分批补发时不会误标其它账号         |
| `apps/bot/src/offline/store.ts`                | 修改 | 透传 `accountId`                                                      |
| `apps/bot/test/napcat-accounts.test.ts`        | 新增 | 账号解析、重复 id、缺失 token、主播分组测试                           |
| `packages/storage/tests/*` / `apps/bot/test/*` | 修改 | 覆盖账号列迁移、状态隔离与摘要过滤                                    |

## 关键决策与取舍

- **一个 `App` 对应一个 NapCat 连接**：保留现有功能上下文与连接看门狗的生命周期，不把
  `FeatureContext` 改成连接集合；账号路由在入口层完成。
- **按主播分配账号**：`up[].qqAccount` 决定该主播的开播、词云、摘要走哪个 QQ。没有做
  「按群分配账号」，因为同一个主播的推送目标通常属于同一批群，按主播配置更简单且不会漂移。
- **未写 `qqAccount` 时用第一个账号**：保证现有单账号配置零改动；多账号配置下也提供明确的
  默认值，错误引用不存在的账号会直接启动失败，避免静默发错号。
- **默认账号继续用旧 `app-state.sqlite`**：站点告警页不需要迁移就能继续显示主号状态；
  其它账号使用独立文件，牺牲「站点同时展示所有账号状态」换取状态机不互相覆盖。
- **`nana.config.yaml` 放连接结构，`.env` 放 token**：沿用仓库现有分工，避免把 token
  提交进受版本控制的配置文件。

## 兼容性与数据安全

- 没有 `napcat.accounts` 时完全走旧版 `NC_WS_URL` / `NC_ACCESS_TOKEN` / `ADM_GROUP`。
- 有 `napcat.accounts` 但某个账号省略 `wsUrl` 时沿用 `NC_WS_URL`；`adminGroup`
  不继承全局 `ADM_GROUP`，避免多个账号的上线 / 下线提示全部落到同一个群。
- 第二个实例可以用 `wsUrlEnv` 指向独立的环境变量（如 `NC_WS_URL_2`），避免把端口写死在
  配置里；配置了 `wsUrlEnv` 但变量缺失会直接报错，不会静默连回主号端口。
- `push_log` 是新增可空列，旧库打开时执行 `ALTER TABLE ... ADD COLUMN account TEXT`；
  历史记录 `account` 为 `NULL`，不影响现有读取与站点接口。
- 离线告警历史仍写入共享的 `app-state.sqlite`，不会因账号隔离丢历史。
- 默认账号的状态文件路径与表结构保持不变。

## 验证

| 验证                   | 命令 / 方式                            | 结果                                                                  |
| ---------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| 构建                   | `pnpm exec vp run @nana/bot#build`     | 通过                                                                  |
| 格式化、lint、类型检查 | `pnpm exec vp check`                   | 通过（仅剩既有测试文件的 lint warning）                               |
| 相关单元测试           | `pnpm exec vp test <5 个相关测试文件>` | 通过：5 文件 / 20 用例                                                |
| 完整单元测试           | `pnpm exec vp test`                    | 33 文件通过；2 个既有 macOS `/private` 临时目录断言失败，与本改动无关 |

## 未决事项 / 后续可选项

- 站点「告警」页目前只展示默认账号的在线状态；其它账号的告警历史可见，但状态需要后续增加
  多账号聚合接口与 UI。
- 没有做「同一主播同时由多个账号推送」；如果出现这种需求，需要把 `qqAccount` 扩展为数组或
  按群映射账号。
