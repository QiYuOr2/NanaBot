<script setup lang="ts">
import { computed } from "vue";
import type { BotAlertItem } from "#shared/alerts";

const props = withDefaults(
  defineProps<{
    /** 一条已经写进告警历史的离线或恢复记录。 */
    alert: BotAlertItem;
    /** 时间轴最后一条，用来收掉竖线。 */
    last?: boolean;
  }>(),
  { last: false },
);

const isOffline = computed(() => props.alert.kind === "offline");
const title = computed(() => (isOffline.value ? "机器人离线" : "机器人已恢复"));
const dotClass = computed(() => (isOffline.value ? "bg-status-red" : "bg-status-teal"));

const timeLabel = computed(() => formatTime(props.alert.createdAt));
const sinceLabel = computed(() => formatTime(props.alert.offlineSince));

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("zh-CN");
}
</script>

<template>
  <article class="flex gap-3">
    <div class="flex w-4 shrink-0 flex-col items-center">
      <span class="mt-1.5 size-2 rounded-full" :class="dotClass" />
      <span v-if="!last" class="mt-1 w-px flex-1 bg-line" />
    </div>

    <div class="min-w-0 flex-1 pb-4">
      <div class="flex items-baseline justify-between gap-3">
        <h2 class="text-[13px] font-medium text-ink">{{ title }}</h2>
        <time class="shrink-0 text-[12px] text-ink-muted" :datetime="alert.createdAt">
          {{ timeLabel }}
        </time>
      </div>
      <p class="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">
        来源 {{ alert.reasonLabel }} · 离线开始于 {{ sinceLabel }}
        <template v-if="alert.downtimeText"> · 持续 {{ alert.downtimeText }}</template>
      </p>
    </div>
  </article>
</template>
