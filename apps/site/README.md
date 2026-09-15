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

### 推送活动的合并规则

推送记录里没有直播场次字段，合并依据是「主播名（`subject`）+ 相邻推送间隔」（见
[shared/push-activity.ts](./shared/push-activity.ts)）：

- 同一次开播会向配置里的每个通知群各推一条记录，`pushedAt` 只相差毫秒，因此同一主播、
  相邻间隔不超过 `PUSH_SESSION_GAP_MS`（默认 30 分钟）的连续记录属于同一次直播；
- `subject` 为空的管理员推送（失败通知、上下线提示）无法归并，各自作为一条活动保留；
- 合并只影响展示：活动的 `items` 保留全部原始记录，接口也照常返回 `logs`，且不修改
  `db/push-log.sqlite` 的结构与数据。

数据通过服务端接口 `GET /api/live-status` 与 `GET /api/push-log` 提供，SSR 时直接取数据再渲染。
`GET /api/push-log` 返回 `{ logs, activities, truncated }`，可用 `?rawLimit=` 覆盖默认的原始记录
读取窗口（默认 500，上限 2000）；窗口被截断时最旧的一条活动可能不完整，会被丢弃。

页面外壳（侧边栏 + 主列）在 `app/layouts/default.vue`，顶栏由 `components/AppHeader.vue` 提供：
它只负责吸顶外壳与面包屑（`trail` 属性），各页面通过 `#status` 插槽补侧边状态、通过默认插槽
传入自己的操作区（概览页是搜索 / 排序 / 刷新，推送活动页只有刷新）。刷新按钮的转圈与禁用
状态收口在 `components/AppRefreshButton.vue`。

## 目录结构（Nuxt 4，`srcDir` 为 `app/`）

```text
apps/site/
  app/
    app.vue
    layouts/default.vue
    pages/index.vue
    pages/pushes.vue
    components/AppHeader.vue
    components/AppRefreshButton.vue
    components/PushActivityItem.vue
    components/StreamerCard.vue
    components/PushLogCard.vue
    components/AppIcon.vue
    components/AppSidebar.vue
    types.ts
  shared/
    push-activity.ts
    push-log.ts
  tests/push-activity.test.ts
  presets/vercel.ts
  server/api/live-status.get.ts
  server/api/push-log.get.ts
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

站点以 `.output/server/index.mjs` 运行，服务端口为 `6364`，通过环境变量 `PORT` 配置
（见 [ecosystem.config.cjs](./ecosystem.config.cjs)）。也可在仓库根用
`pnpm pm2:start` 同时启动 bot 与 site。

## 依赖的 workspace 包

服务端接口直接依赖：

- `@nana/config` —— 读取 `nana.config.yaml`
- `@nana/storage` —— 读取 `db/live-status.sqlite` 与 `db/push-log.sqlite`

这两个包需要先构建出 `dist/`（仓库内已构建）。若克隆后重新构建，可先执行
`vp run @nana/config#build @nana/storage#build`。
