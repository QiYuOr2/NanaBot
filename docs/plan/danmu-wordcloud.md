# 技术方案：整场弹幕记录与词云推送

> 状态：已评审，进入实现
> 相关代码：`packages/storage`、`packages/monitor`、`packages/wordcloud`（新增）、`apps/bot/src/danmu`、`apps/site`

## 1. 需求

主播开播后开始记录弹幕，下播后停止记录；根据本场直播记录的弹幕生成词云，推送到管理员群（`ADM_GROUP`）。同时保留历史场次并在 Web 面板查看。

已确认的产品决策：

| 决策点   | 选择                                                                                 |
| -------- | ------------------------------------------------------------------------------------ |
| 词云呈现 | 本地生成 PNG 图片 + 文字摘要，图片发送失败时降级为纯文字                             |
| 弹幕清洗 | 中文分词 + 停用词 + 默认噪音词表                                                     |
| 起止判定 | 弹幕来自 blive 长连接；结束用「`onLiveEnd` 事件 + 周期轮询 B 站 `live_status` 兜底」 |
| 数据保留 | 存历史场次（场次表 + 逐条弹幕表），面板可查                                          |
| 消息内容 | 完整场次统计：时长、弹幕数、参与人数、Top 词、弹幕王、最高频单条弹幕                 |
| 依赖     | `@node-rs/jieba`（分词）+ `@resvg/resvg-js`（SVG → PNG）                             |

## 2. 现状与复用

- `@nana/monitor` 的 `createBliveMonitorSource` 已经在监听 `onIncomeDanmu`，但目前只在 `monitor.ts` 里特判 `qiyuor2` 发测试事件，弹幕原文被丢弃。
- `apps/bot/src/monitor` 按主播各起一个 monitor，`live.started` / `live.ended` 事件已存在。
- 存储统一在 `packages/storage`（`node:sqlite` + `STRICT` + `busy_timeout`），推送统一走 `NapcatPushClient.sendGroupMsg`（自动写推送记录）。
- 管理员群来自 `ENV_KEYS.ADM_GROUP`，通过 `FeatureContext.adminGroupId` 暴露，`sendAdminMsg` 已可用。

结论：新增「录制 + 生成 + 推送」的领域逻辑放独立包 `@nana/wordcloud`，NapCat 事件绑定与配置胶水留在 `apps/bot/src/danmu`，数据落在 `@nana/storage`。

## 3. 架构

```text
blive 长连接（每个主播唯一一条）
   └─ createMonitor(source, sinks[
        liveStatusSink,      // 直播状态落库
        napcatSink,          // 开播/下播通知到群
        danmuSink,           // 弹幕录制（由 @nana/wordcloud 链路提供 sink 工厂）
      ])
        │ MonitorEvent: live.started / danmu.received / live.ended
        ├─▶ 开播通知、状态落库
        └─▶ DanmuRecorder ──写──▶ @nana/storage(danmu.sqlite)
                     │
                     └─ live.ended / 轮询兜底 ──▶ @nana/wordcloud
                                                    (读弹幕 → 分词 → 统计 → SVG → PNG)
                                                    ▼
                                              sendAdminMsg([text, image])
```

### 3.1 `@nana/monitor`（小改）

`MonitorEvent` 增加被压缩（sub_type=comment）的弹幕事件：

```ts
| {
    type: "danmu.received";
    roomId: number;
    streamer: string;
    content: string;
    userId: number;
    username: string;
    timestamp: Date;
  }
```

`source.ts` 补传 `userId` / `username`；`monitor.ts` 的 `onIncomeDanmu` 只在内容非空时 `emit`。原 `qiyuor2` 测试行为保留。

### 3.2 `@nana/storage`（新增 `danmu.sqlite`）

文件常量 `DANMU_FILE = "danmu.sqlite"`，两张表：

```sql
CREATE TABLE danmu_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  streamer TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  close_reason TEXT,           -- live.ended / poll / shutdown
  msg_count INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE danmu_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  content TEXT NOT NULL
) STRICT;
CREATE INDEX idx_danmu_message_session ON danmu_message(session_id);
```

API：

- `openDanmuSession(input)` → 关闭该直播间所有 `ended_at IS NULL` 的残留场次（`close_reason = "stale"`），插入新场次，返回 `{ id, ... }`。
- `findActiveDanmuSession(roomId)` —— 用于轮询兜底与启动恢复。
- `appendDanmuMessages(sessionId, messages)` —— 批量写入并 `UPDATE msg_count`，**用队列合并批量提交**，忙时最多保留最近 N 条（默认 5000），避免整场开播期间每条弹幕都开关一次数据库连接。
- `closeDanmuSession(id, { endedAt, reason })`。
- `listDanmuSessions(limit)` / `readDanmuSession(id)` / `readDanmuMessages(id)`。

### 3.3 `@nana/wordcloud`（新包）

职责边界：**纯计算 + 渲染**，不碰 NapCat、不碰配置、不碰定时器。

```ts
// 分词与词频
extractWords(contents: string[], options?): WordCount[]      // jieba.cutForSearch + 停用词 + 最少词数 + 单字过滤 + 数字/表情过滤
DEFAULT_STOP_WORDS / DEFAULT_NOISE_WORDS                     // 含主播名/礼物口令等注入项

// 场次统计
summarizeSession(input): DanmuSessionSummary                 // 时长、条数、参与人数、Top 词、弹幕王、最高频单条弹幕

// 渲染
buildWordCloudSvg(words, options?): string                   // 确定性（可注入随机种子），无字体依赖的超时降级
renderWordCloudPng(svg): Promise<Buffer>                     // @resvg/resvg-js；系统无中文字体时抛错由调用方降级
renderSessionMessage(summary, options?): { subject, text }   // 兼容 @nana/notify 的 NotifyMessage 结构
```

- 分词权重：`jieba.cutForSearch()`（搜索引擎模式，短词粒度），过滤停用词、长度 < 2、纯数字/纯符号、纯表情。
- 噪声词：默认内置高频无意义词（`哈哈哈`、`233`、`666`、`主播`、`关注`、`来了`、礼物口令等），并通过配置追加主播名、直播间标题关键词。
- 渲染：分层横排的词云（不做复杂碰撞算法，按权重分档字号 + 螺旋布局 + 固定种子），输出 1000×620 SVG，`@resvg/resvg-js` 转 PNG。字体优先取系统可用中文字体（Windows：微软雅黑 / 黑体；Linux：Noto Sans CJK），可在配置里指定。

### 3.4 `apps/bot/src/danmu`

- `config.ts`：全局 `wordcloud` 段只放分词与渲染（zod，全可选）。是否录制、推到哪些群写在对应主播上，不回落 `ADM_GROUP`：

```yaml
up:
  - uname: 饭总
    wordcloud:
      enabled: true
      notifyGroups: [123456] # 该主播的词云群；空数组只录制不推送
wordcloud:
  topN: 60 # 词云展示词数
  minWordLength: 2
  stopWords: []
  noiseWords: []
  fontPath: "" # 可选，指定中文字体文件
  pollIntervalMs: 300000 # 下播兜底轮询间隔，默认 5 分钟
```

- `store.ts`：弹幕写入队列（批量落库）。
- **单连接原则（重要）**：每个主播只允许**一条** blive 长连接。开播通知、直播状态落库、
  弹幕录制全部订阅同一条连接的事件流，禁止为弹幕另起 monitor。
  - `apps/bot/src/monitor/feature.ts` 的 `createMonitorFeature({ createSink })` 是唯一建连的地方；
    它先挂默认 sink（直播状态 + NapCat 通知），再把 `createSink` 返回的扩展 sink 追加进去。
  - `apps/bot/src/danmu/feature.ts` 的 `createWordCloudMonitorSink` 负责造 `DanmuRecorder` 并
    把 `createDanmuSink` 交给 monitorFeature；`wordCloudFeature` 本身**不建连接**，只消费
    已注册的 `recorders` 做轮询兜底与停机收尾。
  - `apps/bot/src/index.ts` 的接线：先建 `recorders` 表与 sink 工厂，再对每个主播
    `app.use(createMonitorFeature({ createSink }), { ...该主播配置 })`，最后 `app.use(wordCloudFeature, { recorders })`。
  - 回归测试：`apps/bot/test/monitor-shared-connection.test.ts` 断言「单主播只建 1 条连接、
    多主播 = N 条（而非 2N）」，且未开启词云时不会额外建连。
- 事件到动作：
  - `live.started` → `openDanmuSession`（幂等：已有活跃场次则复用）。
  - `danmu.received` → 入队。
  - `live.ended` → `closeDanmuSession` → 生成并推送。
  - 兜底：每 `pollIntervalMs` 用 `@nana/bilibili-api` 查 `live_status`，对「有活跃场次但已不在播」的直播间触发一次收尾；进程退出（`onCleanup`）时 finalize 未结束场次（`close_reason = "shutdown"`）并尽力推送。
  - 推送：按该主播的 `notifyGroups` 逐群 `sendGroupMsg`，`purpose: "wordcloud"`；图片上传/发送失败退化为纯文字；两者都失败则只记日志，不影响其他群。

### 3.5 `@nana/constants`

- `DANMU_FILE = "danmu.sqlite"`
- `PUSH_LOG_PURPOSES` 增加 `"wordcloud"`，`PUSH_PURPOSE_LABELS` 增加「词云」。

### 3.6 `apps/site` 面板

- `server/api/danmu/sessions.get.ts` → `{ sessions: DanmuSessionDto[] }`（按开始时间倒序，含 Top 词摘要）。
- `server/api/danmu/[id].get.ts` → 场次详情 + Top 词 + 统计。
- `server/api/danmu/[id]/wordcloud.get.ts` → 直接返回 `image/png`（用同一套 `@nana/wordcloud` 渲染）。
- `app/pages/danmu.vue`：场次列表 → 点击展开详情（词云图 + Top 词表 + 统计）。
- 侧边栏新增「弹幕词云」入口。

## 4. 关键行为与失败处理

| 场景                      | 行为                                                      |
| ------------------------- | --------------------------------------------------------- |
| 进程重启时直播还在进行    | 启动时读活跃场次继续追加；若 B 站显示已下播则先收尾再生成 |
| 漏收 `live.ended`         | 轮询兜底发现 `live_status != 1` 时收尾并生成              |
| 无中文字体 / PNG 渲染失败 | 只发文字摘要，日志记录原因                                |
| 图片消息发送失败          | 立即降级为纯文字再发一次                                  |
| 弹幕量极大                | 入库批量合并；词云只用词频（全量），图片只画 Top N        |
| 空弹幕（无人说话）        | 发送「本场没有记录到弹幕」的说明，不发图                  |
| 管理员群未配置            | 跳过推送，仅落库，日志 warn                               |

## 5. 测试

- `packages/storage/tests/danmu.test.ts`：场次生命周期、残留场次关闭、批量追加与 `msg_count`、按场次读取。
- `packages/monitor/tests/monitor.test.ts`：`danmu.received` 事件透传。
- `packages/wordcloud/tests/*`：分词与停用词/噪声词、Top 词排序、统计（弹幕王、时长）、SVG 结构（含注入字符转义）、PNG 渲染。
- `apps/bot/test/danmu-feature.test.ts`：开播开录 → 下播收尾并推送、轮询兜底、图片失败退化文字。

## 6. 非目标

- 不做跨场次/长期词云；不做情感分析、弹幕时间轴趋势（可后续在同一场次表上加）。
- 不改动现有开播通知、离线告警逻辑。

## 7. 交付清单与落地状态

| 范围          | 文件                                                                    | 状态 |
| ------------- | ----------------------------------------------------------------------- | ---- |
| 常量          | `packages/constants/src/index.ts`（`DANMU_FILE`、`wordcloud` 推送目的） | ✅   |
| 存储          | `packages/storage/src/danmu.ts`、`types.ts`（场次/弹幕表与 API）        | ✅   |
| 监控事件      | `packages/monitor/src/{types,source,monitor}.ts`（`danmu.received`）    | ✅   |
| 词云包        | `packages/wordcloud/**`（分词、统计、SVG → PNG）                        | ✅   |
| bot 录制/推送 | `apps/bot/src/danmu/**`、`apps/bot/src/index.ts`                        | ✅   |
| Web 面板      | `apps/site/{server/api/danmu,shared/danmu.ts,app/pages/danmu.vue,...}`  | ✅   |
| 配置          | 主播 `up[].wordcloud` 通知 + 全局 `nana.config.yaml#wordcloud` 分词渲染 | ✅   |

### 已验证（真实依赖、真实构建）

安装依赖（`pnpm install`）后，以下命令全部实跑通过：

| 验证                                              | 结果                                          |
| ------------------------------------------------- | --------------------------------------------- |
| `vp check`（格式化 + oxlint + 类型检查）          | ✅ 187 个文件格式正确，0 error                |
| `vp test`                                         | ✅ 26 个文件、152 passed / 1 skipped          |
| `vp run @nana/bot#build`（含 workspace 依赖构建） | ✅ 产出 `apps/bot/dist/index.mjs`             |
| `pnpm build:site`（`nuxt build`）                 | ✅ 产出 `.output/server`，三个 danmu 路由齐全 |
| 起服务实测 `GET /api/danmu/sessions`              | ✅ 返回场次列表 + Top 词                      |
| 起服务实测 `GET /api/danmu/:id`                   | ✅ 返回统计、Top 词、最近弹幕                 |
| 起服务实测 `GET /api/danmu/:id/wordcloud`         | ✅ `image/png` 1000×620，中文字形渲染正常     |
| 端到端「开播→弹幕→下播→推送」                     | ✅ 弹幕全量落库、统计正确、推送 `text+image`  |

构建/运行期的两个坑已在本仓库修好并验证：

1. **bot 打包**：`apps/bot/vite.config.ts` 的 `rollupOptions.external` 增加了
   `@node-rs/jieba` / `@node-rs/jieba/dict` / `@resvg/resvg-js`。原生 `.node` 绑定被打进
   bundle 会报 `stream did not contain valid UTF-8`。
2. **site 打包**：`@nana/wordcloud` 的 `dist` 保持这些原生依赖为 external（`vite.config.ts`
   的 `deps.neverBundle`），Nitro 直接按 node_modules 解析，无需额外 `nitro.externals`。

### 环境要求

- 服务器需要可用的中文字体，否则词云只发文字摘要（推送侧）或返回 500（面板侧）；
  可用 `nana.config.yaml#wordcloud.fontPath` 指定字体文件。
- 新增两个原生依赖 `@node-rs/jieba`、`@resvg/resvg-js`（catalog 已归口），
  首次部署需要 `pnpm install` 拉取对应平台的预编译包。
