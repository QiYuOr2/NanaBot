# 0009 QQ 官方与 NapCat 混合账号

- **状态**：已完成
- **日期**：2026-11-12
- **影响范围**：`apps/bot`、`apps/site`、`packages/config`、`packages/qq`、`packages/storage`
- **关联需求**：同一进程使用多个 QQ 账号，允许一个使用官方 API、另一个使用 NapCat；整理配置及可复用代码。
- **关联条目**：[上一条](./0008-live-summary-full-session.md) · [返回概览](./README.md)

## 背景

原来的全局 `qq.provider` 只能选择一种通道，无法让两个账号分别使用官方 API 和 NapCat。
现在按账号选择连接方式，主播继续使用稳定的 `qqAccount` 标识，推送目标和业务功能随账号归属。

## 变更内容

| 位置                                                | 说明                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `nana.config.yaml.example`                          | 全量配置：混合账号、独立凭据变量、通知群、词云及告警；真实凭据放 `.env`   |
| `packages/config/src/qq-schema.ts`                  | 统一校验顶层配置，归一化为带 `provider` 的账号，校验重复 ID、凭据变量冲突 |
| `apps/bot/src/accounts/`                            | 按职责拆分凭据解析、主播路由、应用工厂和启动隔离；入口只装配业务功能      |
| `packages/qq`                                       | 独立官方通信包，封装连接事件、消息类型、@全体编码、发送结果校验和扫码授权 |
| `packages/config/src/qq-groups.ts` / `qq-update.ts` | 共享目标群枚举、每次发送读取映射、保留注释的原子保存及冲突检查            |
| `packages/config/src/io.ts`                         | 原有配置读写独立为模块，`index.ts` 只导出                                 |
| `apps/site/app/pages/settings.vue`                  | 管理口令解锁，按官方账号绑定群；NapCat 账号单独展示，无需 openid          |
| `packages/storage/src/qq-group.ts`                  | 按账号和 AppID 记录发现的群标识，供 site 选择，不保存聊天正文             |
| `apps/bot/scripts/qq-*.ts`                          | 默认选择第一个官方账号，拒绝对 NapCat 账号扫码或发现群                    |

## 关键决策与取舍

- 使用顶层 `accounts` 列表，每项包含公共字段和同名通道连接子段。服务只由该账号的 `provider` 决定。
- 主播只有显式配置 `qqAccount` 才参与账号监控、录制及推送；未填写时跳过，没有默认账号回退。指定账号不可用时不改发给其他账号。
- 新账号列表按账号隔离缺少凭据和启动错误；全部账号不可用才整体失败。
- 官方通信包保持独立，配置、群映射、推送记录与 OneBot 消息转换由业务适配层处理。两种通道复用已有 `BotApp` 业务接口。
- `groups` 的数字键是本地别名，openid 属于具体官方机器人。site 只修改单个官方账号的单群映射；凭据和通道选择仍通过部署配置修改。

## 配置与数据保存

只支持顶层 `accounts`，连接参数必须放在对应 `official` / `napcat` 子段，不保留旧账号结构、平铺连接参数或环境变量单账号模式。主播需显式指定 `qqAccount`。
修改账号、凭据、通道或主播归属需重启 bot；site 保存到 `accounts[].groups`，下次推送读取生效。

site 的映射读取与修改接口均要求 `NANA_SITE_CONFIG_TOKEN`，至少 16 位，口令仅保存在页面内存。
接口不返回机器人密钥；更新使用期望 openid 检查并发冲突，原子替换 YAML，保留其他账号和注释。
NapCat 消息发送与原有数据表继续使用原逻辑，新增群发现信息独立存于 `db/qq-group.sqlite`。

## 验证

- `vp check`：格式、lint 和类型检查；现存 monitor 测试警告不属于本次改动。
- `vp test`：混合配置、严格结构校验、显式路由与未配置账号跳过、启动与清理错误隔离、完整示例的业务加载器、两种发送适配、官方通信包及 site 实际 HTTP 接口。
- bot / site 生产构建；隔离临时配置进行浏览器解锁、混合账号展示、候选选择、保存及重新加载验证。
- PM2 部署入口保持 `pnpm app deploy all`，不改变应用列表或进程结构。

## 已知限制

官方 @全体由平台控制：机器人需为群管理员，每群每天限一次；权限或额度失败写失败记录，不去掉提醒重试。
参见[官方变更记录](https://bot.q.qq.com/wiki/develop/api-v2/changelog.html#_20261026)。
本地验证不使用真实 QQ 凭据，实际群权限和平台额度需部署后联调。
