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
const hiddenCount = computed(() => props.items.length - visibleItems.value.length);

function titleOf(item: PushActivity): string {
  return item.subject?.trim() || "机器人";
}

function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const diff = Date.now() - date.getTime();
  if (diff < 60_000) {
    return "刚刚";
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}

function absoluteTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("zh-CN");
}
</script>

<template>
  <section class="card flex h-full flex-col p-4">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-[14px] font-medium tracking-tight text-ink">最近推送</h2>
      <NuxtLink
        class="text-[13px] text-accent transition-colors hover:text-accent-dark"
        to="/pushes"
      >
        查看全部
      </NuxtLink>
    </div>

    <p v-if="items.length === 0" class="mt-4 text-[13px] text-ink-muted">暂无推送记录。</p>

    <template v-else>
      <ul class="mt-2">
        <li
          v-for="item in visibleItems"
          :key="item.id"
          class="flex items-baseline gap-2 border-t border-line py-2 first:border-t-0"
        >
          <span class="w-8 shrink-0 text-[12px] text-ink-muted">{{ item.purposeLabel }}</span>
          <p class="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink">
            <span class="font-medium">{{ titleOf(item) }}</span>
            <span v-if="item.content" class="text-ink-secondary"> {{ item.content }}</span>
          </p>
          <time
            class="shrink-0 text-[12px] tabular-nums text-ink-muted"
            :datetime="item.latestAt"
            :title="absoluteTime(item.latestAt)"
          >
            {{ relativeTime(item.latestAt) }}
          </time>
        </li>
      </ul>

      <NuxtLink
        v-if="hiddenCount > 0"
        class="mt-1 text-[12px] text-ink-muted transition-colors hover:text-ink"
        to="/pushes"
      >
        还有 {{ hiddenCount }} 条更早的推送
      </NuxtLink>
    </template>
  </section>
</template>
