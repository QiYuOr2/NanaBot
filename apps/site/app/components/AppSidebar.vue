<script setup lang="ts">
defineProps<{ mobile?: boolean }>();
const emit = defineEmits<{ navigate: []; close: [] }>();

interface NavItem {
  id: string;
  label: string;
  icon: string;
  /** 已实现的页面路由；未实现的导航先保留占位链接。 */
  to?: string;
}

const nav: NavItem[] = [
  { id: "overview", label: "概览", icon: "grid", to: "/" },
  { id: "monitor", label: "直播监控", icon: "monitor", to: "/monitor" },
  { id: "danmu", label: "弹幕词云", icon: "cloud", to: "/danmu" },
  { id: "alerts", label: "告警", icon: "bell", to: "/alerts" },
  { id: "pushes", label: "推送活动", icon: "activity", to: "/pushes" },
  { id: "settings", label: "设置", icon: "settings", to: "/settings" },
];

const route = useRoute();

const NAV_CLASS = "flex items-center gap-2 rounded px-2 py-[7px] text-[13px]";

function isActive(item: NavItem): boolean {
  return item.to !== undefined && route.path === item.to;
}

function navClass(item: NavItem): string {
  return isActive(item)
    ? `${NAV_CLASS} bg-line font-medium text-ink`
    : `${NAV_CLASS} text-ink-secondary hover:bg-line hover:text-ink`;
}
</script>

<template>
  <aside class="flex h-full min-h-0 flex-col border-r border-ink/5 bg-surface">
    <div class="flex shrink-0 items-center justify-between gap-2 px-3 py-3">
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
      <button
        v-if="mobile"
        type="button"
        class="btn-icon size-10"
        aria-label="关闭导航菜单"
        autofocus
        @click="emit('close')"
      >
        <AppIcon name="close" class="size-5" />
      </button>
      <button v-else class="btn-icon" title="更多">
        <AppIcon name="more" />
      </button>
    </div>

    <div class="shrink-0 px-3 pb-2">
      <input class="input-ghost w-full" placeholder="查找" />
    </div>

    <nav
      aria-label="主导航"
      class="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-3 py-1"
    >
      <template v-for="item in nav" :key="item.id">
        <NuxtLink
          v-if="item.to"
          :to="item.to"
          :class="[navClass(item), mobile && 'min-h-11']"
          :aria-current="isActive(item) ? 'page' : undefined"
          @click="emit('navigate')"
        >
          <AppIcon :name="item.icon" class="size-4 shrink-0" />
          {{ item.label }}
        </NuxtLink>
        <a v-else href="#" :class="navClass(item)">
          <AppIcon :name="item.icon" class="size-4 shrink-0" />
          {{ item.label }}
        </a>
      </template>
    </nav>

    <div class="shrink-0 px-3 py-3">
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
