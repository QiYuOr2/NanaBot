<script setup lang="ts">
import type { HeaderTrailItem } from "~/types";

defineProps<{
  /** 面包屑；最后一项视为当前页，其余项按 `to` 决定是否可点击。 */
  trail: HeaderTrailItem[];
}>();
</script>

<template>
  <header
    class="sticky top-0 z-10 flex h-12 items-center gap-4 bg-surface/90 px-6 shadow-header backdrop-blur"
  >
    <nav class="flex shrink-0 items-center gap-2 text-[13px]">
      <template v-for="(item, index) in trail" :key="item.label">
        <span v-if="index > 0" class="text-ink-muted">/</span>
        <NuxtLink
          v-if="item.to && index < trail.length - 1"
          class="text-ink-muted hover:text-ink"
          :to="item.to"
        >
          {{ item.label }}
        </NuxtLink>
        <span v-else :class="index === trail.length - 1 ? 'text-ink' : 'text-ink-muted'">
          {{ item.label }}
        </span>
      </template>

      <slot name="status" />
    </nav>

    <div class="ml-auto flex items-center gap-2">
      <slot />
    </div>
  </header>
</template>
