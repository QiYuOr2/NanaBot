<script setup lang="ts">
import type { HeaderTrailItem } from "~/types";

defineProps<{
  /** 面包屑；最后一项视为当前页，其余项按 `to` 决定是否可点击。 */
  trail: HeaderTrailItem[];
}>();
const sidebarOpen = useMobileSidebar();
</script>

<template>
  <header
    class="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-ink/5 bg-surface/85 px-3 shadow-header backdrop-blur-xl sm:gap-4 sm:px-6"
  >
    <button
      type="button"
      class="btn-icon size-10 shrink-0 lg:hidden"
      aria-label="展开导航菜单"
      aria-controls="mobile-sidebar"
      :aria-expanded="sidebarOpen"
      @click="sidebarOpen = true"
    >
      <AppIcon name="menu" />
    </button>
    <nav
      aria-label="面包屑"
      class="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[13px]"
    >
      <template v-for="(item, index) in trail" :key="item.label">
        <span v-if="index > 0" class="text-ink-muted">/</span>
        <NuxtLink
          v-if="item.to && index < trail.length - 1"
          class="truncate text-ink-muted hover:text-ink"
          :to="item.to"
        >
          {{ item.label }}
        </NuxtLink>
        <span
          v-else
          class="truncate"
          :class="index === trail.length - 1 ? 'text-ink' : 'text-ink-muted'"
        >
          {{ item.label }}
        </span>
      </template>

      <span class="hidden sm:contents"><slot name="status" /></span>
    </nav>

    <div class="ml-auto flex shrink-0 items-center gap-2">
      <slot />
    </div>
  </header>
</template>
