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
  { id: "pushes", label: "推送活动", icon: "send", to: "/pushes" },
  { id: "settings", label: "设置", icon: "settings", to: "/settings" },
];

const route = useRoute();

const NAV_CLASS =
  "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-all duration-200";

function isActive(item: NavItem): boolean {
  return item.to !== undefined && route.path === item.to;
}

function navClass(item: NavItem): string {
  return isActive(item)
    ? `${NAV_CLASS} bg-surface font-medium text-ink shadow-border`
    : `${NAV_CLASS} text-ink-secondary hover:bg-line/70 hover:text-ink`;
}
</script>

<template>
  <aside
    class="flex h-full min-h-0 flex-col border-r border-ink/5 bg-gradient-to-b from-white to-[#fcfaf7]"
  >
    <div class="flex shrink-0 items-center justify-between gap-2 px-3 py-3">
      <button
        class="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-white/80"
      >
        <span
          class="flex size-6 items-center justify-center rounded-[8px] bg-gradient-to-b from-[#f2a24a] to-[#b95412] text-[11px] font-semibold text-white shadow-brand"
        >
          N
        </span>
        <span class="truncate">NanaBot 监控</span>
        <AppIcon name="chevron-down" :size="18" class="text-ink-muted" />
      </button>
      <button
        v-if="mobile"
        type="button"
        class="btn-icon size-10"
        aria-label="关闭导航菜单"
        autofocus
        @click="emit('close')"
      >
        <AppIcon name="close" class="text-ink-muted" />
      </button>
      <button v-else class="btn-icon" title="更多">
        <AppIcon name="more" />
      </button>
    </div>

    <div class="relative shrink-0 px-3 pb-2">
      <AppIcon
        name="search"
        :size="20"
        class="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-ink-muted"
      />
      <input class="input-ghost w-full pl-9" placeholder="查找" />
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
          <AppIcon
            :name="item.icon"
            class="shrink-0"
            :class="
              isActive(item)
                ? 'text-accent-bright'
                : 'text-ink-muted group-hover:text-accent-bright'
            "
          />
          {{ item.label }}
        </NuxtLink>
        <a v-else href="#" :class="navClass(item)">
          <AppIcon
            :name="item.icon"
            class="shrink-0"
            :class="
              isActive(item)
                ? 'text-accent-bright'
                : 'text-ink-muted group-hover:text-accent-bright'
            "
          />
          {{ item.label }}
        </a>
      </template>
    </nav>

    <div class="shrink-0 px-3 py-3">
      <div class="rounded-lg bg-canvas p-3 shadow-border">
        <div class="flex items-start gap-2.5">
          <span class="icon-tile size-7 shrink-0">
            <AppIcon name="bell" :size="20" class="text-accent-bright" />
          </span>
          <div class="min-w-0">
            <p class="text-[12px] font-medium text-ink">提示</p>
            <p class="mt-1 text-[12px] leading-relaxed text-ink-muted">
              将 bot 与站点一起运行，即可同步最新的直播状态。
            </p>
          </div>
        </div>
      </div>

      <div class="mt-3 flex items-center gap-2 px-1 text-[13px] text-ink-secondary">
        <span
          class="flex size-6 items-center justify-center rounded-full bg-line text-[11px] font-medium"
        >
          N
        </span>
        <span class="truncate">NanaBot</span>
        <span class="ml-auto">
          <AppIcon name="more" :size="20" class="text-ink-muted" />
        </span>
      </div>
    </div>
  </aside>
</template>
