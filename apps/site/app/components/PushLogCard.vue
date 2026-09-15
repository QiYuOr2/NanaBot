<script setup lang="ts">
import { computed } from "vue";
import { PUSH_ACTIVITY_PANEL_LIMIT } from "#shared/push-activity";
import type { PushActivity } from "~/types";

const props = withDefaults(
  defineProps<{
    /** 已经按「同一次直播」合并好的推送活动。 */
    items: PushActivity[];
    /** 最多展示的条数，默认为面板页的 5 条。 */
    limit?: number;
  }>(),
  { limit: PUSH_ACTIVITY_PANEL_LIMIT },
);

const visibleItems = computed(() => props.items.slice(0, props.limit));
</script>

<template>
  <section class="card flex h-full flex-col p-4">
    <div class="flex items-start justify-between">
      <div>
        <h2 class="text-[14px] font-medium tracking-tight text-ink">最近推送活动</h2>
        <p class="mt-0.5 text-[12px] text-ink-muted">同一场直播已合并</p>
      </div>
      <NuxtLink
        class="text-[13px] text-accent transition-colors hover:text-accent-dark"
        to="/pushes"
      >
        查看全部
      </NuxtLink>
    </div>

    <p v-if="items.length === 0" class="mt-4 text-[13px] text-ink-muted">暂无推送记录。</p>

    <ol v-else class="mt-3">
      <li v-for="(item, index) in visibleItems" :key="item.id">
        <PushActivityItem :activity="item" :last="index === visibleItems.length - 1" />
      </li>
    </ol>
  </section>
</template>
