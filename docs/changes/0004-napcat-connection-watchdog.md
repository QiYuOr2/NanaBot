# 0004 NapCat 连接看门狗：断线后不再需要人工重启

- **状态**：已完成
- **日期**：2026-10-10
- **影响范围**：`apps/bot`（`src/core`、`src/offline`、入口重连配置、测试、诊断脚本）+ 文档
- **关联需求**：NapCat 里登录的 QQ 掉线后邮件通知正常，但重新登录 QQ 之后机器人不会自己连回来，必须重启 bot；希望不用重启，或者至少有办法不登服务器就能恢复。
- **关联条目**：[上一条](./0003-layout-and-header.md) · [返回概览](./README.md)

## 现象与根因

**现象**：QQ 掉线 → 收到离线邮件（说明告警链路正常）；重新登录 NapCat 的 QQ 之后 → 机器人一直不连回来，`pm2` 里进程还是 `online`，只能手动重启 bot。

**根因**：`node-napcat-ts@0.4.25` 的重连是「有预算、一次性的」，而且它自己不会把连接救回来；bot 侧又完全没有兜底监测。具体四条失效路径（都已在 [探针脚本](../../apps/bot/scripts/probe-napcat-reconnect.ts) 里复现）：

| #   | 失效路径                         | 触发条件                                                                                                      | 后果                                                                                                                |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | **重连预算耗尽**                 | 原配置 `attempts: 10, delay: 5000`：每次 `onclose` 只有 `nowAttempts < attempts` 才排下一次重连，用完永久停止 | 只覆盖约 **45 秒**。NapCat 重启 + QQ 扫码重登远超这个窗口，之后再也不重连                                           |
| 2   | **`connect()` 变成空操作并挂起** | 路径 1 之后内部 `#socket` / `#connectingPromise` 都是陈旧值                                                   | `connect()` 既不报错也不重连，返回的 Promise **永不 settle**；只有 `reconnect()`（内部先 `disconnect()`）才救得回来 |
| 3   | **失败响应永久关闭自动重连**     | 库收到 `{ status: "failed", echo: null }` 帧时 `#reconnection.enable = false` 并主动 `disconnect()`           | `enable` 再也不会被重置，**必须新建实例（= 重启 bot）** 才能恢复                                                    |
| 4   | **TCP 半开 / 卡在 CONNECTING**   | 对端消失但本端收不到 `close`（防火墙、NAT、进程被 kill -9 等）                                                | `socket.close` 永不触发，重连逻辑根本没机会跑；进程仍 `online`，PM2 的 `autorestart` 也不会拉起                     |

路径 1 最可能是这次现象的直接原因：QQ 掉线期间 bot 很快用完了 45 秒预算，等管理员扫码重登完（几分钟），库早就永久放弃了；PM2 看到进程还活着，所以也不会重启它。本次没有线上日志可以逐条核对（旧的 bot 没有订阅 `socket.error`，库里也不会自己打日志），所以路径 3/4 不能排除——好在它们同样被看门狗覆盖。

**探针实测（关键证据）**：

```text
[1] 库的重连预算：端口 18111 无人监听（模拟 NapCat 停机/重登期间）
  事件序列：connecting -> error(connect_error) -> close(now=1)
          -> connecting -> error(connect_error) -> close(now=2)
          -> connecting -> error(connect_error) -> close(now=3)     ← attempts=3，到此为止
  ✔ attempts=3 时库只尝试 3 次连接后彻底停止
  ✔ 重试耗尽后 connect() 不会重连
  ✔ 重试耗尽后 connect() 返回的 Promise 永不 settle（实际 pending）
  ✔ reconnect() 能真正恢复连接（看门狗可用的唯一手段）

[2] 库遇到 {status:"failed",echo:null}：自动重连被永久关闭
  事件序列：connecting -> open -> error(response_error,enable=false) -> close(now=1)
  ✔ 库收到失败帧后不再自动重连（attempts=5 也只连了 1 次）
```

## 变更内容

| 文件                                                                                             | 类型 | 说明                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/bot/src/core/connection.ts`](../../apps/bot/src/core/connection.ts)                       | 新增 | `ConnectionSupervisor` 连接看门狗：订阅 socket/事件总类事件，巡检并强制 `reconnect()`；`settleWithin` 超时竞速；连接类日志按 5 分钟节流；重连相关常量收口于此 |
| [`apps/bot/src/core/createApp.ts`](../../apps/bot/src/core/createApp.ts)                         | 修改 | 创建看门狗并在 `start()` 里**先于**首次连接启动；首次 `connect()` 加 15s 超时避免启动挂死；`stop()` 先停看门狗；新增 `app.connection` 与 `connection` 配置项  |
| [`apps/bot/src/core/index.ts`](../../apps/bot/src/core/index.ts)                                 | 修改 | barrel 导出看门狗与相关常量                                                                                                                                   |
| [`apps/bot/src/index.ts`](../../apps/bot/src/index.ts)                                           | 修改 | `attempts: 10` → `UNLIMITED_RECONNECT_ATTEMPTS`（不再给库设预算），`delay` 改用 `RECONNECT_DELAY_MS`                                                          |
| [`apps/bot/src/offline/feature.ts`](../../apps/bot/src/offline/feature.ts)                       | 修改 | 恢复判定改为「以心跳为准」：`socket.open` 不再直接判恢复，避免 QQ 仍离线时发假恢复邮件；新增 `store` / `recoveryFallbackMs` 注入点                            |
| [`apps/bot/src/offline/index.ts`](../../apps/bot/src/offline/index.ts)                           | 修改 | barrel 导出 `DEFAULT_RECOVERY_FALLBACK_MS`                                                                                                                    |
| [`apps/bot/test/connection.test.ts`](../../apps/bot/test/connection.test.ts)                     | 新增 | 看门狗 12 个单测（注入时钟，确定性）：不插手库自己的重试、库放弃后接管、失败响应后接管、探活成功/失败、半开刷新、冷却、退订、日志节流、`settleWithin`         |
| [`apps/bot/test/offline-feature.test.ts`](../../apps/bot/test/offline-feature.test.ts)           | 新增 | 离线告警 4 个单测：QQ 仍离线时重连不发假恢复邮件、QQ 真回来才发、没有心跳时兜底判恢复、清理取消兜底计时器                                                     |
| [`apps/bot/scripts/probe-napcat-reconnect.ts`](../../apps/bot/scripts/probe-napcat-reconnect.ts) | 新增 | 诊断探针：复现上面 4 条库失效路径，并用真实 `ConnectionSupervisor` + 真实 WS 服务器端到端验证自愈（`pnpm --filter @nana/bot probe:reconnect`）                |
| [`apps/bot/package.json`](../../apps/bot/package.json)                                           | 修改 | 新增 `probe:reconnect` 脚本                                                                                                                                   |

**看门狗的两条判据**（`ConnectionSupervisor.check()`，每 10s 一次）：

1. **自称断开、且 20s 内没有任何 socket 活动** → 认为库已经不管了（路径 1/2/3 都会让活动时间停滞），强制 `reconnect()`。
   库自己还在重试时（每 5s 一次 `connecting`/`error`/`close`）活动时间会被不断刷新，所以看门狗**不会**和库抢。
2. **自称已连接、但 60s 收不到任何 NapCat 事件** → 用 `get_status()` 主动探活（10s 超时）；**只把「无响应」当作链路已死**（NapCat 回了什么、QQ 自身是否离线都不影响），失败才强制 `reconnect()`。这条专门治路径 4 的半开连接。

### 顺带修掉的三个长期离线副作用

QQ 掉线后长时间不登录，会把这个改动的几个边界放大出来，因此一并处理：

1. **恢复邮件误报**。原逻辑把 `socket.open` 直接当成「连接恢复」，于是「QQ 仍离线、只是 WS 抖动重连」会先发一封假的恢复邮件，随后又被心跳判回离线 → 来回刷邮件。现在改为**以心跳为准**：重连后等下一次心跳用 `status.online` 定论（在线才算恢复），只有迟迟收不到心跳（未配置心跳的部署）才由 90s 兜底计时器退回旧行为。
2. **日志刷屏**。库改成无限重试后，每次连接失败都会产生一条 `socket.error` + 一条 `socket.close`，长期离线就是每 5 秒两行、约 3~4 MB/天。现在连接类日志按 `logThrottleMs`（默认 5 分钟）节流：断开时先打一条详情（含 code 与尝试次数），之后每 5 分钟一条摘要（含最新尝试次数与看门狗最近动作）；`connect_error` 不再单独打（紧跟的 `socket.close` 已经带了同样信息）；「已连接」日志单独走一个窗口，抖动时两个方向各留一条。
3. **看门狗不会因为 QQ 离线而空转**。QQ 离线但 NapCat 进程还在时，心跳（哪怕是 `online: false`）仍算入向流量，看门狗完全不重连——既避免假的恢复邮件，也不会反复重建连接。

## 关键决策与取舍

- **不 fork / 不 patch 第三方库**：`node-napcat-ts` 的私有字段（`#socket`、`#connectingPromise`、`#reconnection`）拿不到，patch 需要额外维护成本；改为在 bot 侧用公开 API（`subscribe` / `reconnect` / `get_status`）做看门狗。
- **只用 `reconnect()`，绝不用 `connect()`**：探针已证明重试耗尽后 `connect()` 既无效又会挂起；`reconnect()` 内部的 `disconnect()` 会顺手清掉陈旧的 `#socket` 与 `#connectingPromise`。
- **用「冷却时间」而不是「在途锁」**：这是实测踩出来的——目标不可达时 `reconnect()` 内部一直等只在 socket 打开时才 resolve 的 `connect()`，**永远不会 settle**。第一版用 Promise 的 `.finally()` 当在途标志，端到端探针直接失败（一次强制重连把看门狗锁死 60s，NapCat 回来也不再尝试）。改成 `reconnectCooldownMs`（默认 5s）后两个场景都通过。
- **保留库自己的重试当快路径**：`attempts` 设为无限（每 5s 一次）而不是关掉，短抖动几秒内就能自愈；看门狗只在库不管了的时候才出手，平时完全不干预，避免双重重连。
- **探活只看「有没有响应」，不看 `status.online`**：NapCat 活着但 QQ 未登录是**正常**状态（正是等管理员重登的窗口），此时把链路的连接判死会导致疯狂重连并刷出假的「恢复」邮件。
- **看门狗放 `core/` 而不是新 package**：它只服务 bot 的连接生命周期，是纯 app 层胶水（符合 skill 里「只在一个 app 内用」的边界）；通用部分（`settleWithin`）也还只有这一处用，暂不上提 `@nana/utils`。
- **首次连接加超时**：原来 `await napcat.connect()` 在 NapCat 不在线时会永久挂住（探针证实 Promise 永不 settle），`state` 卡在 `starting`、`syncLiveStatus` 也跑不到。现在 15s 后打日志继续启动，由看门狗持续重试。
- **恢复以心跳为准，而不是以 `socket.open` 为准**：「WS 连上」和「QQ 在线」是两层状态，只有心跳能反映后者。代价是恢复通知会晚一个心跳周期（通常几秒），换来的是不再出现「恢复↔离线」来回刷。兜底计时器（90s）保证未配置心跳的部署不会永远卡在离线态（否则 `reportConnectionLost` 会在已离线时直接返回，后续离线告警全被吞掉）。
- **日志用节流而不是降级日志级别**：这些日志是排障的主要线索，不能一关了之；把「必须可见」的状态跳变（连接建立、断开详情）留在节流窗口之外第一时间输出，把重复的失败刷屏压成 5 分钟一条摘要。
- **离线告警的状态机放在 app 层调整**：`@nana/offline-detector` 保持通用（只认「离线/在线 + 原因」），「WS 层与 QQ 层如何合成在线状态」是 NapCat 事件绑定的知识，留在 `apps/bot/src/offline`。

## 兼容性与数据安全

- 无接口/数据结构变化，`db/*.sqlite` 与推送记录字段不变，无需迁移。（`@nana/offline-detector`、`@nana/storage` 这两个包本身未改。）
- 新增配置项 `createApp({ connection })` 与 `offlineDetectorFeature({ store, recoveryFallbackMs })` 全部可选，缺省即启用默认值。
- 对既有功能的影响：`socket.open` 触发「我来了~」的逻辑未改（恢复后同样会提示）；离线告警的**判定阈值与持久化格式未改**，改的只是「什么时候算恢复」——恢复邮件会晚一个心跳周期（通常几秒），且不再出现假的恢复邮件。
- 日志行为变化：连接类日志由「每次事件都打」变为「5 分钟窗口内最多一条」，`pm2 logs` 里仍能看到状态跳变与周期性摘要，但不再逐条刷。
- 安全性：不引入新端口、新依赖、新鉴权面。

## 部署与验证

**部署**（改动只在 bot，不影响 site）：

```bash
pnpm app deploy bot     # 构建 + 只重启 bot
pm2 logs @nana/bot      # 确认启动日志
```

**上线后确认生效**（日志关键字，`NC_DEBUG=1` 时信息更全）：

| 日志                                                                     | 含义                                                                       |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `[连接看门狗] NapCat WebSocket 已连接`                                   | 连接建立（首次与重连都会打；5 分钟窗口内最多一条）                         |
| `[连接看门狗] NapCat WebSocket 断开（code=…，库已尝试 N 次）`            | 本轮第一次断开，含断开码与库已重试次数                                     |
| `[连接看门狗] 仍未连上 NapCat（库已尝试 N 次，看门狗：…）`               | 断开期间的周期性摘要，5 分钟一条；`看门狗：` 后面是它最近一次出手的原因    |
| `[连接看门狗] NapCat 返回失败响应，库已永久关闭自动重连，改由看门狗接管` | 命中失效路径 3，看门狗接手（**这类「强制重建连接」字样出现就说明修好了**） |
| `[NanaBot] 首次连接 NapCat 超过 15000ms 未成功…`                         | 启动时 NapCat 不在线，已交给看门狗                                         |

> 连接类日志按 `logThrottleMs`（默认 5 分钟）节流，长期离线不会刷屏；正常运行时距上次输出早已超过窗口，状态变化照旧第一时间可见。离线/恢复邮件的日志仍在 `[离线检测]` 前缀下，不受节流影响。

**验证记录**：

| 验证                       | 命令 / 方式                                                                  | 结果                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 格式化、lint、类型检查     | `vp check`                                                                   | 通过：145 个文件格式正确，108 个文件无 warning / lint / type 错误                         |
| 单元测试                   | `vp test`                                                                    | 通过：18 个测试文件、75 个用例（新增 `connection` 12 个、`offline-feature` 4 个）         |
| 库失效路径复现             | `pnpm --filter @nana/bot probe:reconnect`                                    | 通过：4 条失效路径全部复现（见上文实测输出）                                              |
| 端到端自愈（重连预算耗尽） | 同上探针场景 3：真实 `NCWebsocket` + 真实 WS 服务器，服务器掐断 700ms 后重启 | 通过：库已停止重连，看门狗接管并自动连回，**无需重启进程**                                |
| 端到端自愈（失败响应）     | 同上探针场景 4：首帧下发 `{status:"failed",echo:null}` 关掉库的自动重连      | 通过：看门狗接管并自动连回                                                                |
| 日志节流                   | `connection.test.ts`：60s 窗口内 21 次断开                                   | 通过：只留「断开详情 + 一条摘要 + 一条已连接」共 3 行                                     |
| 恢复邮件不误报             | `offline-feature.test.ts`：离线中模拟 WS 抖动重连                            | 通过：只发 1 封离线邮件；QQ 心跳恢复在线时才补发恢复邮件，没有心跳时由兜底计时器判恢复    |
| workspace 包构建           | `vp run @nana/bot#build`（依赖包部分）                                       | 8 个包全部 `Build complete`（本机需把 dts 生成器从 tsgo 换成 oxc，见未决事项）            |
| 生产构建（bot 本身）       | `pnpm app deploy bot`                                                        | **未能在本机完成**：bot 的 `tsc` 步骤与本机环境冲突（见未决事项），需在服务器上跑一次确认 |

## 如果还是连不上：应急恢复

看门狗覆盖了已知的四条失效路径，但真出现「连不上又不想登服务器」时，可选手段按代价排序：

1. **先看日志再动手**：`pm2 logs @nana/bot --lines 200` 里搜 `连接看门狗`。如果看到周期性的「仍未连上 NapCat（…，看门狗：…强制重建连接）」，说明 bot 在持续努力重连，此时**问题在 NapCat 侧**（QQ 没登上、WS 端口/token 变了），重启 bot 没有意义。
2. **重启 bot**（不需要登服务器 _手动_ 操作，但需要能执行仓库命令的环境）：
   `pnpm app restart bot`，或直接 `pm2 restart @nana/bot`。
   注意：**这条路必须能访问到那台服务器**（SSH 或等价通道）。
3. **想彻底不碰服务器**：需要一个「独立于 bot 的进程」来代劳——bot 掉线时它连 QQ 消息都收不到，所以**QQ 群指令自救是不可行的**；可行的是在已经在跑的 Web 面板（`@nana/site`，独立进程、独立端口）上加一个带 token 的 `POST /api/bot/restart`，由它执行 `pm2 restart @nana/bot`，这样手机点一下就恢复。本次按选择未实现，需要的话可以作为下一步。

## 未决事项 / 后续可选项

- **本机跑不完 `@nana/bot#build`（与本次改动无关）**：仓库锁的是 TypeScript 7（原生 `tsc`/`tsgo`），本机环境下它报 `fspy: failed to create ipc sender: 拒绝访问。(os error 5)`，于是 `vp pack` 的 tsgo dts 生成和 bot 自己的 `tsc && vp build` 都无法完成。已确认这不是本次改动引入的：报错全部落在未改动的包与 `tsc` 步骤上；把包配置的 dts 生成器临时换成 `oxc` 后 8 个 workspace 包都能 `Build complete`。类型安全由 `vp check`（TypeScript 检查通过、0 error）覆盖。**上线前请务必在服务器上跑一次 `pnpm app deploy bot`**，确认构建与重启都正常。
- **`socket.open` 每次都发「我来了~」**：真出现频繁抖动时管理员群会被刷屏，可后续加个「距上次上线超过 N 分钟才提示」的节流。（日志已经节流了，这条只影响 QQ 群消息。）
- **长时间离线期间的开播通知会丢，且不补发（已知限制，本次未改）**：NapCat 侧 QQ 离线时 `send_group_msg` 必然失败，[`NapcatPushClient`](../../apps/bot/src/core/napcat.ts) 只记一条失败推送记录然后抛错，没有重试队列。一次开播 = 6 个群各一条失败群推送 + 各一条失败管理员通知 = 12 条失败记录，而群里什么都没收到。要真正避免丢通知，需要「连接不可用时把要发的内容落库、连接恢复后补发（带时效）」——本次按选择未实现。直播状态与面板、离线告警邮件均不受影响。
- **探活依赖 `get_status`**：若将来换用不支持该 action 的 OneBot 实现，需要改成 `get_login_info` 或 `get_version_info`（都在 `NCWebsocketApi` 里）。
- **确认 NapCat 端口**：仓库里 `apps/bot/.env` 的 `NC_WS_URL=ws://127.0.0.1:6364`，而 `AGENTS.md` 记录 site 的 PM2 端口也是 `6364`。请在生产环境确认这个端口确实是 NapCat 的 WS 端口（site 的 `ecosystem.config.cjs` 里写的是 `PORT=3000`，可能只是文档过期），避免端口占用导致的偶发连不上。
- **未做固化回归**：库失效路径的复现放在探针脚本里（Node 原生跑 TS，不新增依赖），没有进 `vp test`，因为 `ws` 不是仓库的直接依赖。若要把它变成 CI 必跑的测试，需要把 `ws` 加进 catalog 与 `apps/bot` 的 devDependencies。
