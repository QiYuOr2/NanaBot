<script setup lang="ts">
import { computed } from "vue";
import {
  getPushActivityTone,
  PUSH_ACTIVITY_PANEL_LIMIT,
  summarizePushActivities,
  type PushActivityTone,
} from "#shared/push-activity";
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

const summary = computed(() => summarizePushActivities(props.items));
const visibleItems = computed(() => props.items.slice(0, props.limit));

const TONE_BADGE: Record<PushActivityTone, string> = {
  delivered: "bg-live/10 text-live",
  pending: "bg-status-orange/10 text-status-orange",
  failed: "bg-status-red/10 text-status-red",
};

/** 面板顶部的送达摘要：失败 / 待确认优先，全部正常时只显示「全部送达」。 */
const badge = computed(() => {
  const { failedTargetCount, pendingTargetCount, activityCount, failedActivityCount } =
    summary.value;
  if (failedTargetCount > 0) {
    return {
      tone: "failed" as PushActivityTone,
      label: `${failedTargetCount} 个群未送达`,
      title: `${failedActivityCount} 条活动里有群未送达（按群去重）`,
    };
  }
  if (pendingTargetCount > 0) {
    return {
      tone: "pending" as PushActivityTone,
      label: `${pendingTargetCount} 个群待确认`,
      title: "推送失败但还在确认窗口内，稍后刷新查看",
    };
  }
  return {
    tone: "delivered" as PushActivityTone,
    label: activityCount > 0 ? "全部送达" : "暂无记录",
    title: "最近的活动都已在所有目标群送达",
  };
});
</script>

<template>
  <section class="card flex h-full flex-col p-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-[14px] font-medium tracking-tight text-ink">最近推送活动</h2>
        <p class="mt-0.5 text-[12px] text-ink-muted">同一场直播已合并 · 按群去重</p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span
          v-if="items.length > 0"
          class="rounded px-1.5 py-0.5 text-[11px] font-medium"
          :class="TONE_BADGE[badge.tone]"
          :title="badge.title"
        >
          {{ badge.label }}
        </span>
        <NuxtLink
          class="text-[13px] text-accent transition-colors hover:text-accent-dark"
          to="/pushes"
        >
          查看全部
        </NuxtLink>
      </div>
    </div>

    <p v-if="items.length === 0" class="mt-4 text-[13px] text-ink-muted">暂无推送记录。</p>

    <template v-else>
      <ol class="mt-3">
        <li v-for="(item, index) in visibleItems" :key="item.id" class="mt-1 first:mt-0">
          <PushActivityItem
            :activity="item"
            :highlight="getPushActivityTone(item) !== 'delivered'"
            :last="index === visibleItems.length - 1"
          />
        </li>
      </ol>

      <NuxtLink
        v-if="items.length > visibleItems.length"
        class="mt-1 text-[12px] text-ink-muted transition-colors hover:text-ink"
        to="/pushes"
      >
        还有 {{ items.length - visibleItems.length }} 条更早的活动
      </NuxtLink>
    </template>
  </section>
</template>
