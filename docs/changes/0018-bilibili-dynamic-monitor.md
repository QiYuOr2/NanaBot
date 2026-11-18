# 0018 Bilibili UP 主动态监控与推送

- **状态**：已完成
- **日期**：2026-11-18
- **影响范围**：`packages/bilibili-api`、`packages/storage`、`packages/constants`、`apps/bot`、配置与文档
- **关联需求**：为 Bot 增加 UP 主动态监控（视频 / 图文 / 专栏），独立于直播监控，去重后推送到 QQ 群，支持官方 API 与 NapCat 双通道。
- **关联条目**：[上一条](./0017-site-log-tags-and-scroll.md) · [返回概览](./README.md)

## 背景

此前 Bot 只监控 B 站直播间开播 / 下播事件，无法感知 UP 主发布的视频、图文或专栏动态。需求要求：
动态监控与直播监控生命周期独立，可只开动态不开直播；首次启用不推送历史；同一动态不重复推送；
进程重启可恢复待推送；按 UP 主的 `qqAccount` 明确路由，不跨账号、不跨通道自动降级；图片发送失败
不能丢失整条通知。参考 Boku 的 Go 实现移植 WBI 签名、匿名 Cookie、风控 / 签名错误处理与动态解析。

## 变更内容

| 文件                                                              | 类型      | 说明                                                                                  |
| ----------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------- |
| `packages/bilibili-api/src/dynamic/types.ts`                      | 新增      | 动态原始响应与标准化 `BilibiliDynamic` 类型                                           |
| `packages/bilibili-api/src/dynamic/wbi.ts`                        | 新增      | WBI mixin key 重排表、Go 兼容 `QueryEscape`、签名参数生成                             |
| `packages/bilibili-api/src/dynamic/session.ts`                    | 新增      | 浏览器身份头、匿名 Cookie（白名单 6 项）、WBI key 6h 缓存与 -352 失效刷新             |
| `packages/bilibili-api/src/dynamic/http.ts`                       | 新增      | 带超时的 fetch + Set-Cookie 提取                                                      |
| `packages/bilibili-api/src/dynamic/parser.ts`                     | 新增      | 置顶过滤、视频/opus/draw/专栏/转发/未知解析、正文容错与缺字段跳过                     |
| `packages/bilibili-api/src/dynamic/client.ts`                     | 新增      | Feed 请求、空列表有限重试、-352 刷新重试、-412 风控与业务错误分类                     |
| `packages/bilibili-api/src/dynamic/errors.ts`                     | 新增      | `BilibiliDynamicError`（带 kind：network/http/business/signature/risk-control/parse） |
| `packages/bilibili-api/src/dynamic/index.ts`、`src/index.ts`      | 新增/修改 | 动态 API 导出（`dynamic` 命名空间 + 顶层类型）                                        |
| `packages/bilibili-api/tests/dynamic.test.ts`、`tests/fixtures/*` | 新增      | 固定 fixture 单元测试（不依赖真实网络）                                               |
| `packages/constants/src/index.ts`                                 | 修改      | 新增 `DYNAMIC_FILE`，`PUSH_LOG_PURPOSES` / 标签新增 dynamic.video/opus/article        |
| `packages/storage/src/dynamic.ts`                                 | 新增      | `dynamic.sqlite`：dynamic_item / dynamic_monitor_state + 事务发现、去重、出队状态     |
| `packages/storage/src/types.ts`、`src/index.ts`                   | 修改      | 动态存储类型与导出                                                                    |
| `packages/storage/tests/dynamic.test.ts`                          | 新增      | bootstrap、去重、UID 隔离、成功/失败状态、重启恢复测试                                |
| `apps/bot/src/dynamic/config.ts`                                  | 新增      | 独立动态配置加载（读取所有 up，只看 dynamic: true）                                   |
| `apps/bot/src/dynamic/formatter.ts`                               | 新增      | 视频/图文/专栏文案格式化、码点安全截断、最多 3 图                                     |
| `apps/bot/src/dynamic/sender.ts`                                  | 新增      | 按通道图片上限发送、失败降级为文本+链接、单群失败隔离                                 |
| `apps/bot/src/dynamic/monitor.ts`                                 | 新增      | 单 UID 轮询（bootstrap/增量）、去重入队、outbox 刷送与恢复                            |
| `apps/bot/src/dynamic/scheduler.ts`                               | 新增      | 统一调度、全局并发、single-flight、抖动、指数退避、可停止                             |
| `apps/bot/src/dynamic/feature.ts`、`index.ts`                     | 新增      | 动态监控 Feature 生命周期 + 模块导出                                                  |
| `apps/bot/src/index.ts`                                           | 修改      | 加载动态配置、按 qqAccount 路由、注册动态 Feature、集成启动/停止                      |
| `apps/bot/tests/dynamic-*.test.ts`                                | 新增      | 监控、调度、格式、发送单元测试                                                        |
| `nana.config.yaml.example`、`README.md`                           | 修改      | 动态配置示例、功能与配置说明                                                          |

## 关键决策与取舍

- **动态 API 放在 `@nana/bilibili-api`**：与直播 API 同包，复用构建与测试基建；不引入 Boku 的 Go 依赖。
- **独立动态监控模块 `apps/bot/src/dynamic/`**：HTTP 轮询而非直播间长连接，不能塞进 `@nana/monitor` 的 Sink。
- **复用 `storage` 的 node:sqlite 模式**：新增独立 `dynamic.sqlite`，不与直播状态 / 弹幕 / 推送日志混用。
- **push-log 复用**：通过现有 `context.sendGroupMsg`（内部 `writePushLog`）写推送记录，不新建日志表。
- **账号路由**：沿用 `up[].qqAccount`，缺失 / 未知 / 不可用一律跳过并告警，绝不回退默认账号；通道失败也不切换 provider。
- **图片能力差异**：官方 QQ 单条仅 1 图、NapCat 支持多图，按通道上限截断；任何图片失败降级为文本 + 原链接。
- **空列表 vs 错误**：请求失败 / 风控 / 签名错误均抛异常，不推进游标；空列表有限重试（默认 3 次）后才当作「确实没有」。

## 兼容性与数据安全

- `dynamic` 字段默认 false，老配置无该字段时行为完全不变（不影响直播 / 弹幕 / 词云 / 摘要 / 离线告警）。
- 新增独立数据库 `db/dynamic.sqlite`，建表与补列幂等，无历史数据迁移。
- 首次同步失败不标记初始化，下次仍为 bootstrap；请求失败不推进游标，不会漏推送或重复推进。
- 发送成功但进程在落库前退出可能重复推送一次（QQ 与 SQLite 非分布式事务），窗口极小。
- 图片仅存 URL，不下载原图入库。

## 验证

| 验证                   | 命令 / 方式                               | 结果                                                                                                                       |
| ---------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 格式化、lint、类型检查 | `vp check`                                | 通过（0 error，仅既有 warning）                                                                                            |
| 单元测试               | `vp test`（bilibili-api / storage / bot） | 211 passed（含新增 42 条）                                                                                                 |
| 全仓测试               | `vp test`                                 | 408 passed，9 failed（`deploy-*`/`project-logs` 因 Windows 需要管理员权限创建符号链接，属环境问题，pristine 基线同样失败） |
| 构建                   | `vpr build:bot`（tsc && vp build）        | 成功                                                                                                                       |

## 未决事项 / 后续可选项

- B 站匿名接口可能变更或触发风控（-352 / -412），匿名访问不承诺始终可用；已做分类处理，但无法消除上游风险。
- 官方 QQ 单条图片限制 1 张，图文最多 3 张的完整能力仅在 NapCat 通道可用。
- 第一版不做动态评论 / 点赞、关键词过滤、Web 动态历史页面与用户登录态。
- 可后续增加按时间清理旧动态记录、动态历史浏览页。
