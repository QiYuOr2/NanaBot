# 0007 Bot 文件日志与按账号拆分

- **状态**：已完成
- **日期**：2026-11-11
- **影响范围**：`apps/bot`
- **关联需求**：日志原先只依赖 PM2 汇总，多个 NapCat 账号的输出全部混在同一个文件里。
- **关联条目**：[上一条](./0006-multi-napcat-accounts.md) · [返回概览](./README.md)

## 背景

多个 QQ 号运行在同一个 bot 进程里，PM2 只有一组 `out_file` / `error_file`。
连接看门狗、直播间监控、弹幕录制和推送失败日志会交错在一起，排查某个账号时很难区分
消息属于哪个 NapCat 实例，也不能脱离 PM2 保留日志。

## 变更内容

| 文件                              | 类型 | 说明                                           |
| --------------------------------- | ---- | ---------------------------------------------- |
| `apps/bot/src/core/logger.ts`     | 新增 | 文件日志、控制台镜像、账号级 scope、大小轮转   |
| `apps/bot/src/core/feature.ts`    | 修改 | `FeatureContext` 增加当前账号的 `logger`       |
| `apps/bot/src/core/createApp.ts`  | 修改 | 核心连接、推送、启停日志统一走账号 logger      |
| `apps/bot/src/index.ts`           | 修改 | 创建日志管理器，并把账号 logger 注入每个 `App` |
| `apps/bot/src/monitor/*`          | 修改 | 直播监控、状态落库、开播推送错误写入账号日志   |
| `apps/bot/src/danmu/*`            | 修改 | 弹幕录制、词云渲染与推送日志写入账号日志       |
| `apps/bot/src/offline/feature.ts` | 修改 | 离线告警记录 / 发送失败写入账号日志            |
| `apps/bot/src/summary/publish.ts` | 修改 | 直播摘要补发日志写入账号 logger                |
| `apps/bot/test/logger.test.ts`    | 新增 | 账号日志隔离与文件轮转测试                     |

## 关键决策与取舍

- **按 QQ 号拆分，而不是按日志级别拆分**：排查时最需要回答「这条日志属于哪个 NapCat」。
  文件内仍带 `DEBUG / INFO / WARN / ERROR` 级别，需要时可直接 `rg`。
- **项目根目录落盘**：路径固定为 `<projectRoot>/logs`，与 `db/` 一样不依赖 PM2 的 `cwd`。
- **继续镜像控制台**：文件是持久化来源，控制台仍保留 `pnpm app logs bot` 的实时观察能力。
- **同步追加 + 大小轮转**：日志量不高，使用 `appendFileSync` 保证退出前尽量不丢；
  默认 10 MiB 轮转、保留 5 份，避免依赖 `pm2-logrotate`。
- **进程级与账号级分离**：启动失败、账号跳过等跨账号事件写 `logs/bot.log`；
  NapCat 连接、直播间、弹幕、推送等写各自账号文件。

## 兼容性与数据安全

- 不新增运行时依赖，不改 `nana.config.yaml`。
- 日志路径已在 `.gitignore` 中忽略，不会误提交。
- 日志写入失败只输出控制台错误，不影响机器人主流程。
- PM2 配置保持不变，原有 `pnpm app logs bot` 仍可用。

## 验证

| 验证                   | 命令 / 方式                                      | 结果                                                                           |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| 格式化、lint、类型检查 | `pnpm exec vp check`                             | 通过                                                                           |
| 日志隔离与轮转测试     | `pnpm exec vp test apps/bot/test/logger.test.ts` | 通过                                                                           |
| Bot 构建               | `pnpm exec vp run @nana/bot#build`               | 通过                                                                           |
| 全量单元测试           | `pnpm exec vp test`                              | 222 通过、1 跳过；2 个既有的 macOS `/private` 临时目录断言失败，与本次改动无关 |
| 主号通知端到端         | 本地假 NapCat + 缺失第二实例变量                 | 第二账号被跳过，主号仍向 `646247690` 发送「我来了~」，账号日志独立             |
