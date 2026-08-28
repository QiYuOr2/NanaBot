# @nana/site

NanaBot 的直播状态展示 Web 应用，基于 Nuxt 4 + Vite+ (`vp`) 开发。UI 参考 Vercel 的
设计语言：单色画布、用 box-shadow 替代边框、幽灵按钮、状态用小圆点而非大面积色块，
字体使用 Geist Sans / Geist Mono（`@fontsource/geist-*`），样式由 UnoCSS（预设
`presetWind3` + 自定义的 Vercel preset）生成。默认样式通过 `@unocss/reset/tailwind.css`
重置，所有设计令牌与组件类集中在 `presets/vercel.ts`（`presetVercel`）中。

## 功能

一个基础页面，用来展示 `nana.config.yaml` 中开启监控的主播及其当前直播状态：

- 读取 `nana.config.yaml` 的 `up` 列表，得到主播名与直播间号；
- 读取 `db/live-status.sqlite`（由 `@nana/storage` 维护）得到每个房间的直播状态；
- 合并后在页面上以卡片形式展示“直播中 / 未开播”，并提供手动刷新按钮。

数据通过服务端接口 `GET /api/live-status` 提供，SSR 时直接取数据再渲染。

## 目录结构（Nuxt 4，`srcDir` 为 `app/`）

```text
apps/site/
  app/
    app.vue
    pages/index.vue
    components/StreamerCard.vue
    components/AppIcon.vue
    components/AppSidebar.vue
    types.ts
  presets/vercel.ts
  server/api/live-status.get.ts
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

## 依赖的 workspace 包

`server/api/live-status.get.ts` 直接依赖：

- `@nana/config` —— 读取 `nana.config.yaml`
- `@nana/storage` —— 读取 `db/live-status.sqlite`

这两个包需要先构建出 `dist/`（仓库内已构建）。若克隆后重新构建，可先执行
`vp run @nana/config#build @nana/storage#build`。
