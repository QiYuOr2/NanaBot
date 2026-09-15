# 0003 页面外壳与顶栏抽取

- **状态**：已完成
- **日期**：2026-09-15
- **影响范围**：`apps/site`（layout、顶栏组件、刷新按钮、两个页面与侧边栏）
- **关联需求**：两个页面的 header 基本一致，虽然刷新与搜索功能不同，也应该把公共部分封装起来，差异部分单独传入
- **关联条目**：[上一条 0002](./0002-push-activity-page.md) · [返回概览](./README.md)

## 背景

新增 `/pushes` 页面后，两个页面的顶栏几乎逐行重复：吸顶容器样式、`NanaBot / 当前页` 面包屑、右侧操作区、刷新按钮（含转圈与禁用逻辑）。差异只有三点：

1. 面包屑当前页是「概览」还是「推送活动」，以及上级是否可点击；
2. 概览页在面包屑后面多一个「监控中」状态；
3. 操作区不同：概览页是「搜索框 + 排序图标按钮 + 刷新」，推送活动页只有「刷新」。

## 关键决策：抽成组件，而不是塞进 layout

直觉上会想把 header 放进 `layouts/default.vue`，由页面传入差异。但 Nuxt 的 layout 渲染在页面外层，**页面无法把插槽或状态传给 layout**：layout 只能通过 `definePageMeta` 拿到静态元信息，拿不到 index.vue 里的 `query`、`sortLive`、`pending`。

要做到「layout 渲染 header + 页面传差异」，就必须把搜索词、排序状态、刷新函数提升到 `useState` / store 这类全局状态里——正好违反本次「不引入新的状态管理」的约束，而且会让 layout 依赖页面逻辑，耦合方向反了。

所以最终方案是：**layout 只保留外壳（侧边栏 + 主列），顶栏抽成 `AppHeader` 组件，由各页面渲染并通过属性 / 插槽传入差异**。

```text
layouts/default.vue
├── AppSidebar
└── <slot>                      ← 页面内容
    ├── index.vue
    │   └── AppHeader trail=[NanaBot, 概览]   #status=监控中  ⌄ 搜索 / 排序 / AppRefreshButton
    └── pushes.vue
        └── AppHeader trail=[NanaBot→/, 推送活动]                     ⌄ AppRefreshButton
```

## 变更内容

| 文件                                            | 类型 | 说明                                                                                                          |
| ----------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| `apps/site/app/layouts/default.vue`             | 新增 | 侧边栏 + 主列外壳（`flex min-h-screen bg-canvas font-sans text-ink antialiased`），内容走默认插槽。           |
| `apps/site/app/app.vue`                         | 修改 | `<NuxtLayout><NuxtPage /></NuxtLayout>`，让所有页面走默认布局。                                               |
| `apps/site/app/components/AppHeader.vue`        | 新增 | 吸顶顶栏：面包屑（`trail` 属性）+ `#status` 插槽 + 默认插槽（右侧操作区）。                                   |
| `apps/site/app/components/AppRefreshButton.vue` | 新增 | 刷新按钮：`pending` 时转圈并禁用，文案在「刷新 / 刷新中...」间切换。                                          |
| `apps/site/app/pages/index.vue`                 | 修改 | 外壳交给布局，顶栏改为 `AppHeader` + 状态插槽 + 搜索 / 排序 / 刷新。                                          |
| `apps/site/app/pages/pushes.vue`                | 修改 | 顶栏改为 `AppHeader` + 刷新按钮。                                                                             |
| `apps/site/app/types.ts`                        | 修改 | 新增 `HeaderTrailItem`（`{ label, to? }`），两个页面的面包屑共用。                                            |
| `apps/site/app/components/AppSidebar.vue`       | 修改 | 导航项改为 `NavItem`（可选 `to`），有路由的渲染 `NuxtLink` 并按 `route.path` 高亮，其余保持 `href="#"` 占位。 |

## 组件契约

`AppHeader`：

| 输入           | 类型                | 说明                                                                                      |
| -------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `trail`        | `HeaderTrailItem[]` | 面包屑；最后一项视为当前页（`text-ink`，不可点击），前面的项若带 `to` 则渲染成 `NuxtLink` |
| `#status` 插槽 | —                   | 面包屑之后的补充内容（概览页的「监控中」状态）                                            |
| 默认插槽       | —                   | 右侧操作区，由页面放自己的按钮（自动 `ml-auto`）                                          |

`AppRefreshButton`：

| 输入      | 类型      | 默认值  | 说明                                            |
| --------- | --------- | ------- | ----------------------------------------------- |
| `pending` | `boolean` | `false` | 为 true 时展示转圈、禁用按钮并显示「刷新中...」 |
| `@click`  | —         | —       | 未声明 emit，靠属性透传落到根 `<button>` 上     |

## 验证

| 验证                   | 命令 / 方式                   | 结果                                                                                                                                                                                                           |
| ---------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 格式化、lint、类型检查 | `vp check`                    | 通过（134 文件格式、103 文件无 warning / lint / type 错误）                                                                                                                                                    |
| 单元测试               | `vp test`                     | 通过（16 文件 59 用例，不受本次重构影响）                                                                                                                                                                      |
| 构建                   | `pnpm build:site`             | 通过                                                                                                                                                                                                           |
| SSR 输出对比           | 构建产物请求 `/` 与 `/pushes` | 两个页面各渲染 1 个 header；面包屑分别是「NanaBot / 概览」「NanaBot / 推送活动」；「监控中」与搜索框只出现在概览页；推送活动页只有刷新按钮；两页刷新按钮输出完全一致（`btn-primary h-8 text-[13px] ... 刷新`） |

## 未决事项 / 后续可选项

- 若以后再加页面，优先在 `AppHeader` 上补插槽（例如操作区之外的 `#meta`），不要往 layout 里塞页面逻辑——layout 一旦依赖页面状态，就必须引入全局状态，这条边界值得守住。
- 「监控中」目前是静态文案；如果以后要反映真实的监控连接状态，来源应是 `/api/live-status` 之外的状态接口，届时把值作为 `#status` 插槽内容传入即可，`AppHeader` 不需要改。
