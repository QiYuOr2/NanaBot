# 0012 site 测试消息改走 bot 控制接口

- **状态**：已完成
- **日期**：2026-11-12
- **影响范围**：`apps/bot`、`apps/site`、`packages/constants`
- **关联需求**：site 的测试消息要验证 bot 的实际发送能力，而不是验证 AppID / AppSecret 能否直连官方 API。
- **关联条目**：[上一条](./0011-site-mobile-navigation.md) · [返回概览](./README.md)

## 背景

原实现由 site 直接创建 `QQClient`，用账号凭据调用官方 HTTP API。这样验证的是凭据和官方接口，绕过了 bot 的账号路由、`BotApp` 实现、官方 / NapCat 通道差异以及 bot 侧推送记录；NapCat 账号也无法通过同一入口测试。

## 变更内容

| 文件                                      | 类型 | 说明                                                                    |
| ----------------------------------------- | ---- | ----------------------------------------------------------------------- |
| `apps/bot/src/control/testMessage.ts`     | 新增 | 校验请求、定位运行中账号、调用 `BotApp.sendGroupMsg`，由 bot 写推送记录 |
| `apps/bot/src/control/server.ts`          | 新增 | 仅监听 `127.0.0.1` 的 HTTP 控制接口，复用管理口令鉴权                   |
| `apps/bot/src/index.ts`                   | 修改 | 用已启动账号构建运行时映射，启动 / 关闭控制接口                         |
| `apps/site/server/utils/qqTestMessage.ts` | 修改 | 删除 site 直连 QQ SDK，改为带口令调用 bot 控制接口                      |
| `apps/site/package.json`                  | 修改 | 移除不再需要的 `@nana/qq` 依赖                                          |
| `packages/constants/src/index.ts`         | 修改 | 增加控制接口地址、端口与路径常量                                        |

控制接口为 `POST http://127.0.0.1:6365/api/qq/test-message`，请求只包含 `accountId`、`groupId`、`expectedOpenid` 与 `kind`；固定文案由 bot 生成，site 不能指定任意目标或正文。成功返回 `{ ok: true, target }`，失败返回 `{ ok: false, error }`。

## 关键决策与取舍

- 控制接口只监听回环地址，避免把机器人发送能力暴露到公网；跨主机部署需要另行调整监听和网络策略。
- 复用 `NANA_SITE_CONFIG_TOKEN` 鉴权，不新增第二套管理口令；bot 从进程环境或 `apps/site/.env` 读取，因此同一份 site 配置即可生效。
- 真正发送走运行中的 `BotApp.sendGroupMsg`：官方账号复用已建立的 `QQClient` 和 `OfficialPushClient`，NapCat 账号复用现有 WebSocket；不再由 site 创建第二个发送客户端。
- 推送记录只由 bot 的推送客户端写入，避免 site 和 bot 各写一条。
- 发送仍要求映射已保存且 `expectedOpenid` 一致；发送失败原样返回，不降级为不带 @全体的普通消息。
- site 到 bot 的请求设置 15 秒超时。超时提示用户先确认群内结果再重试，避免盲目重复发送。

## 兼容性与数据安全

- 不改变 `nana.config.yaml`、`db/*.sqlite` 或接口字段结构；历史推送记录不受影响。
- bot 必须正在运行，且对应账号启动成功；否则 site 返回 `503`。bot 与 site 默认需在同一主机。
- site 不再读取或持有机器人 AppSecret；控制接口错误和 bot 推送记录都会隐藏 AppSecret。
- 未保存映射、过期映射、未知账号和额外字段均在发送前拒绝，不产生推送记录。

## 验证

| 验证                   | 命令 / 方式                                   | 结果                            |
| ---------------------- | --------------------------------------------- | ------------------------------- |
| 格式化、lint、类型检查 | `vp check`                                    | 通过，0 error                   |
| 单元测试               | `vp test`                                     | 50 个文件、294 项通过，1 项跳过 |
| bot 控制接口           | 鉴权、账号路由、官方 / NapCat、失败与密钥隐藏 | 4 项通过                        |
| site 代理              | 成功、参数拒绝、bot 503、发送失败、不可达     | 12 项通过                       |
| 构建                   | bot + site 生产构建                           | 均通过                          |

## 未决事项 / 后续可选项

- 当前控制接口固定监听 `127.0.0.1`。若 bot 与 site 分开部署，需要增加监听地址配置、网络 ACL 与 HTTPS 或私网隧道。
