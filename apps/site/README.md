# @nana/site

NanaBot 的直播状态展示 Web 应用，基于 Nuxt 4 + Vite+ (`vp`) 开发。UI 参考 Vercel 的
设计语言：单色画布、用 box-shadow 替代边框、幽灵按钮、状态用小圆点而非大面积色块，
字体使用 Geist Sans / Geist Mono（`@fontsource/geist-*`），样式由 UnoCSS（预设
`presetWind3` + 自定义的 Vercel preset）生成。默认样式通过 `@unocss/reset/tailwind.css`
重置，所有设计令牌与组件类集中在 `presets/vercel.ts`（`presetVercel`）中。

## 功能

两个页面：概览（`/`）展示 `nana.config.yaml` 中开启监控的主播及其当前直播状态，并展示最近
推送活动；推送活动页（`/pushes`）展示全部推送活动与每个群的送达明细。

- 读取 `nana.config.yaml` 的 `up` 列表，得到主播名与直播间号；
- 读取 `db/live-status.sqlite`（由 `@nana/storage` 维护）得到每个房间的直播状态；
- 合并后在页面上以卡片形式展示“直播中 / 未开播”、直播标题、分区与直播人气，并提供
  顶部“刷新”按钮与卡片右上角“···”菜单里的“更新直播状态”（主动调用 B 站 API）。
- 读取 `db/push-log.sqlite`，按「同一次直播」合并后以「最近推送活动 · 时间轴视图」卡片展示
  最近 5 条活动：主播、目标群数量与昵称、目的（开播 / 上线 / 下线 / 通知）、相对时间与
  「已送达 / 失败」状态；大屏时与主播卡片并排，移动端垂直堆叠。卡片右上角「查看全部」
  跳转到 `/pushes`，那里展示全部活动并展开每个群的送达明细。

### 弹幕词云（`/danmu`）

读取 `db/danmu.sqlite`（由 `@nana/storage` 维护的「场次 + 逐条弹幕」两表），左侧列出历史场次
（开始时间、主播、时长、弹幕数、参与人数、Top 词摘要），点击任一场次后右侧展示：场次统计
（时长、弹幕数、参与人数、每分钟弹幕数、弹幕王、最高频单条弹幕）、词云图、Top 词表与最近
200 条弹幕（最新在前）。

- 词云图由服务端用 `@nana/wordcloud` 的 `buildWordCloudSvg` + `renderWordCloudPng` 生成，
  与推送到管理员群的图片使用同一套分词与渲染规则；PNG 渲染失败时自动降级为 SVG。
- 分词规则与 bot 保持一致（见 `apps/bot/src/danmu/wordCloud.ts`）：主播名与
  `nana.config.yaml` 的 `wordcloud.stopWords` / `wordcloud.noiseWords` 一起作为噪音词叠加，
  `wordcloud.minWordLength` 控制最短词长，`wordcloud.fontPath` 指定渲染字体。
- 性能：列表接口只为最近 10 场计算 Top 词，更早的场次 `topWords` 返回空数组；详情接口的
  Top 词与统计复用 `summarizeSession`，弹幕只返回最近 200 条。

### 推送活动的合并规则

推送记录里没有直播场次字段，合并依据是「主播名（`subject`）+ 相邻推送间隔」（见
[shared/push-activity.ts](./shared/push-activity.ts)）：

- 同一次开播会向配置里的每个通知群各推一条记录，`pushedAt` 只相差毫秒，因此同一主播、
  相邻间隔不超过 `PUSH_SESSION_GAP_MS`（默认 30 分钟）的连续开播 / 下播记录属于同一次直播；
- 只有开播 / 下播（`aggregatablePurposes`）参与合并；`subject` 为空的管理员推送（失败通知、
  上下线提示）以及词云等单目标推送各自作为一条活动保留；
- 合并只影响展示：活动的 `items` 保留全部原始记录，接口也照常返回 `logs`，且不修改
  `db/push-log.sqlite` 的结构与数据。

### 送达状态口径

成败**按群**统计，而不是数原始记录（见 [shared/push-presentation.ts](./shared/push-presentation.ts)）：

- 每个群的最终结果以它最近一次推送为准：`successCount + failureCount + pendingTargetCount
  === targetCount`；失败后重试成功的群算成功，并通过 `retryCount` 标注「重试后送达」；
- 失败的推送在 `PUSH_PENDING_WINDOW_MS`（60 秒）内展示为「待确认」，超过窗口仍是失败才展示
  「未送达」，避免把慢回执 / 重复推送误报成失败；
- 活动徽标、时间轴圆点、群明细徽标、面板摘要、`/pushes` 统计共用同一套文案与颜色（
  `PUSH_STATUS_LABELS` / `PUSH_STATUS_CHIP_CLASS` / `PUSH_STATUS_DOT_CLASS`）。

数据通过服务端接口 `GET /api/live-status` 与 `GET /api/push-log` 提供，SSR 时直接取数据再渲染。
`GET /api/push-log` 返回 `{ logs, activities, truncated, generatedAt }`，可用 `?rawLimit=` 覆盖默认的原始记录
读取窗口（默认 500，上限 2000）；窗口被截断时最旧的一条活动可能不完整，会被丢弃。

弹幕词云页的数据接口：

| 接口                           | 说明                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `GET /api/danmu/sessions`      | `{ sessions, limit }`，按开播时间倒序；`?limit=` 覆盖条数（默认 20，上限 100）                     |
| `GET /api/danmu/:id`           | 场次统计 + Top 词（前 30）+ 最近 200 条弹幕（倒序）；不存在返回 404                                |
| `GET /api/danmu/:id/wordcloud` | 登录后返回 `image/png`（`Cache-Control: no-store`）；`?format=svg` 返回 SVG 文本，渲染失败返回 500 |

页面外壳（侧边栏 + 主列）在 `app/layouts/default.vue`，顶栏由 `components/AppHeader.vue` 提供：
它只负责吸顶外壳与面包屑（`trail` 属性），各页面通过 `#status` 插槽补侧边状态、通过默认插槽
传入自己的操作区（概览页是搜索 / 排序 / 刷新，推送活动页只有刷新）。刷新按钮的转圈与禁用
状态收口在 `components/AppRefreshButton.vue`。

小屏（`< 1024px`）隐藏固定侧边栏，顶栏左侧的菜单按钮打开 `components/AppMobileSidebar.vue`
抽屉；点击导航、遮罩或按 Esc 收起，路由变化后自动关闭并恢复页面滚动。抽屉状态由
`app/composables/useMobileSidebar.ts` 按请求隔离，桌面端仍使用固定侧边栏。

设置页的「测试普通消息 / 测试 @全体」由 `POST /api/settings/qq-groups/test` 转发给 bot
内部控制接口（默认 `http://127.0.0.1:6365`，见 `NANA_BOT_CONTROL_URL`），不会在 site
内创建 QQ 客户端。实际发送、账号路由和 `message.test` 推送记录都由运行中的 bot 完成；
bot 不可达时接口返回 `503`。

## 全站登录与运维页面

根目录 `.env#NANA_AUTH_TOKEN` 是 bot 与 site 共用管理口令，至少 16 位；兼容原
`apps/site/.env#NANA_SITE_CONFIG_TOKEN`。登录后使用 30 天 HttpOnly 签名 Cookie，所有业务页面
与 API 统一鉴权，设置页无需再次解锁。更换口令后旧会话失效，侧栏支持退出登录。

- `/logs`：选择项目 `logs/` 中的应用、账号或轮转日志，读取末尾 100 / 500 / 1000 / 2000 行，
  最多 256 KiB。只在进入页面、切换文件 / 行数或点击刷新时读取。
- `/system`：进入或刷新时采集 CPU、内存、交换空间、磁盘用量，以及 NVIDIA GPU 使用率、
  显存与温度。需要 `nvidia-smi` 才能读取 GPU，无 GPU 工具时其余指标仍可用。
- `/api/health`：无需登录的最小健康检查，供部署脚本使用。

系统指标及日志均来自 site 运行环境。部署到其他服务器或容器后，应确保 site 能访问项目根目录。
CI 只在 `apps/site`、site 直接 / 间接依赖包、共享构建配置或部署脚本变化时运行；可手动触发。

## 目录结构（Nuxt 4，`srcDir` 为 `app/`）

```text
apps/site/
  app/
    app.vue
    composables/useMobileSidebar.ts
    layouts/default.vue
    pages/index.vue
    pages/pushes.vue
    pages/danmu.vue
    components/AppHeader.vue
    components/AppRefreshButton.vue
    components/PushActivityItem.vue
    components/StreamerCard.vue
    components/PushLogCard.vue
    components/DanmuSessionList.vue
    components/DanmuWordCloud.vue
    components/DanmuWordList.vue
    components/DanmuMessageList.vue
    components/AppIcon.vue
    components/AppSidebar.vue
    components/AppMobileSidebar.vue
    types.ts
  shared/
    danmu.ts
    push-activity.ts
    push-log.ts
    push-presentation.ts
  tests/push-activity.test.ts
  presets/vercel.ts
  server/api/danmu/[id].get.ts
  server/api/danmu/sessions.get.ts
  server/api/danmu/[id]/wordcloud.get.ts
  server/api/live-status.get.ts
  server/api/push-log.get.ts
  server/utils/danmu.ts
  server/utils/streamers.ts
  nuxt.config.ts
  uno.config.ts
  package.json
```

## 使用

从仓库根执行：

```bash
pnpm install
pnpm dev:site        # 在 http://localhost:3000 启动开发服务器
pnpm build:site      # 生产构建（输出到 .output/）
```

也可在 `apps/site` 内直接运行：

```bash
pnpm dev
```

## PM2 运行

生产模式下用 PM2 启动（需要先构建 `pnpm build:site`，产出 `.output/`）：

```bash
pm2 start ecosystem.config.cjs     # 在 apps/site 内
pm2 restart @nana/site
pm2 logs @nana/site
```

站点以 `.output/server/index.mjs` 运行，服务端口为 `3000`，通过环境变量 `PORT` 配置
（见 [ecosystem.config.cjs](./ecosystem.config.cjs)）。也可在仓库根用
`pnpm pm2:start` 同时启动 bot 与 site；只更新本站点时用 `pnpm app deploy site`（构建 +
只重启 `@nana/site`），或 `pnpm app restart site` 跳过构建直接重启。
内存较小的服务器可加 `--stop-before-build`：`pnpm app deploy site --stop-before-build`，
构建期间先释放旧站点占用的内存，构建失败会自动尝试恢复。

更推荐由 [GitHub Actions](../../.github/workflows/site.yml) 在 Linux x64 构建 site，
服务器只接收 `.output` 产物。未配置 `DEPLOY_*` secrets 时 workflow 只上传 artifact；
配置后会通过 SSH 原子替换产物、重启 `@nana/site` 并做健康检查。

## 依赖的 workspace 包

服务端接口直接依赖：

- `@nana/config` —— 读取 `nana.config.yaml`（主播列表与 `wordcloud` 段）
- `@nana/storage` —— 读取 `db/live-status.sqlite`、`db/push-log.sqlite` 与 `db/danmu.sqlite`
- `@nana/wordcloud` —— 弹幕分词、场次统计与词云 SVG/PNG 渲染（只在 `server/` 引入，
  含 `@node-rs/jieba` / `@resvg/resvg-js` 原生依赖，不会进入客户端 bundle）
- `@nana/utils` —— `formatDuration` 等时间格式化

这些包需要先构建出 `dist/`（仓库内已构建）。若克隆后重新构建，可先执行
`vp run @nana/config#build @nana/storage#build @nana/wordcloud#build`。
