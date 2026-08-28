<script setup lang="ts">
const nav = [
  { id: "overview", label: "概览", icon: "grid" },
  { id: "monitor", label: "直播监控", icon: "monitor" },
  { id: "alerts", label: "告警", icon: "bell" },
  { id: "activity", label: "面板", icon: "activity" },
  { id: "settings", label: "设置", icon: "settings" },
];
</script>

<template>
  <aside
    class="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col border-r border-ink/5 bg-surface lg:flex"
  >
    <div class="flex items-center justify-between gap-2 px-3 py-3">
      <button
        class="flex items-center gap-2 rounded px-2 py-1.5 text-[13px] font-medium text-ink hover:bg-line"
      >
        <span
          class="flex size-5 items-center justify-center rounded bg-ink text-[11px] font-semibold text-white"
        >
          N
        </span>
        <span class="truncate">NanaBot 监控</span>
        <AppIcon name="chevron-down" class="text-ink-muted" />
      </button>
      <button class="btn-icon" title="更多">
        <AppIcon name="more" />
      </button>
    </div>

    <div class="px-3 pb-2">
      <input class="input-ghost w-full" placeholder="查找" />
    </div>

    <nav class="flex-1 space-y-0.5 overflow-y-auto px-3 py-1">
      <a
        v-for="item in nav"
        :key="item.id"
        href="#"
        class="flex items-center gap-2 rounded px-2 py-[7px] text-[13px]"
        :class="
          item.id === 'overview'
            ? 'bg-line font-medium text-ink'
            : 'text-ink-secondary hover:bg-line hover:text-ink'
        "
      >
        <AppIcon :name="item.icon" class="size-4 shrink-0" />
        {{ item.label }}
      </a>
    </nav>

    <div class="px-3 py-3">
      <div class="rounded-md bg-canvas p-3">
        <p class="text-[12px] font-medium text-ink">提示</p>
        <p class="mt-1 text-[12px] leading-relaxed text-ink-muted">
          将 bot 与站点一起运行，即可同步最新的直播状态。
        </p>
      </div>

      <div class="mt-3 flex items-center gap-2 px-1 text-[13px] text-ink-secondary">
        <span
          class="flex size-5 items-center justify-center rounded-full bg-line text-[11px] font-medium"
        >
          N
        </span>
        <span class="truncate">NanaBot</span>
        <span class="ml-auto">
          <AppIcon name="more" class="text-ink-muted" />
        </span>
      </div>
    </div>
  </aside>
</template>
