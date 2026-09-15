<script setup lang="ts">
import { computed } from "vue";
import type { PushActivity } from "~/types";

const props = withDefaults(
  defineProps<{
    /** 已经按「同一次直播」合并好的推送活动。 */
    activity: PushActivity;
    /** 是否是时间轴的最后一条，用于隐藏连线。 */
    last?: boolean;
    /** 是否展开该活动下的每条原始推送（群明细）。 */
    showTargets?: boolean;
  }>(),
  { last: false, showTargets: false },
);

const AVATAR_COLORS = [
  "bg-status-pink",
  "bg-status-blue",
  "bg-status-cyan",
  "bg-status-teal",
  "bg-status-orange",
  "bg-status-red",
];

const PURPOSE_TAG: Record<string, string> = {
  "live.start": "bg-status-pink/10 text-status-pink",
  "live.end": "bg-status-teal/10 text-status-teal",
  "app.online": "bg-status-blue/10 text-status-blue",
  "app.offline": "bg-status-cyan/10 text-status-cyan",
  notification: "bg-status-orange/10 text-status-orange",
};

const avatarKey = computed(
  () => props.activity.subject || props.activity.targets[0]?.target || "•",
);

const avatarColor = computed(() => {
  let hash = 0;
  for (const ch of avatarKey.value) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? "bg-status-blue";
});

const avatarChar = computed(() => avatarKey.value.charAt(0) || "•");

const title = computed(
  () =>
    props.activity.subject?.trim() || props.activity.content?.trim() || props.activity.purposeLabel,
);

/** 目标群摘要：单个群直接展示昵称，多个群展示数量与昵称列表。 */
const targetSummary = computed(() => {
  const targets = props.activity.targets;
  if (targets.length === 1) {
    return targets[0]?.target ?? "—";
  }
  return `${targets.length} 个群 · ${targets.map((item) => item.target).join("、")}`;
});

const statusLabel = computed(() => {
  const { failureCount, successCount } = props.activity;
  if (failureCount === 0) {
    return "已送达";
  }
  if (successCount === 0) {
    return "全部失败";
  }
  return `${failureCount} 失败`;
});

const statusTitle = computed(
  () =>
    props.activity.items
      .filter((item) => !item.success)
      .map((item) => `${item.target}: ${item.error ?? "未知错误"}`)
      .join("\n") || "",
);

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
</script>

<template>
  <div class="flex gap-3">
    <span
      class="w-16 shrink-0 whitespace-nowrap pt-1 text-right text-[12px] tabular-nums text-ink-muted"
    >
      {{ relativeTime(activity.latestAt) }}
    </span>

    <div class="flex flex-col items-center">
      <span
        class="mt-1.5 size-2.5 shrink-0 rounded-full"
        :class="activity.failureCount > 0 ? 'bg-status-red' : 'bg-live'"
      />
      <span v-if="!last" class="mt-1 w-px flex-1 bg-line" aria-hidden="true" />
    </div>

    <span
      class="flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
      :class="avatarColor"
    >
      {{ avatarChar }}
    </span>

    <div class="min-w-0 flex-1 pb-4">
      <div class="flex min-w-0 items-center gap-2 text-[13px] leading-snug text-ink">
        <span
          class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium"
          :class="PURPOSE_TAG[activity.purpose] ?? PURPOSE_TAG.notification"
        >
          {{ activity.purposeLabel }}
        </span>
        <span class="min-w-0 truncate">{{ title }}</span>
      </div>

      <p
        v-if="activity.subject && activity.content"
        class="mt-1 truncate text-[12px] text-ink-secondary"
      >
        {{ activity.content }}
      </p>

      <div class="mt-1 flex min-w-0 items-center gap-1 text-[12px] text-ink-muted">
        <span class="shrink-0">→</span>
        <span class="min-w-0 truncate">{{ targetSummary }}</span>
      </div>

      <ul v-if="showTargets" class="mt-2 space-y-1 border-l border-line pl-3">
        <li
          v-for="target in activity.targets"
          :key="target.targetId"
          class="flex min-w-0 items-center gap-2 text-[12px] text-ink-muted"
        >
          <span class="min-w-0 truncate">{{ target.target }}</span>
          <span
            class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium"
            :class="target.success ? 'bg-live/10 text-live' : 'bg-status-red/10 text-status-red'"
            :title="target.error ?? ''"
          >
            {{ target.success ? "已送达" : "失败" }}
          </span>
        </li>
      </ul>
    </div>

    <span
      class="shrink-0 self-start rounded px-1.5 py-0.5 text-[11px] font-medium"
      :class="
        activity.failureCount === 0 ? 'bg-live/10 text-live' : 'bg-status-red/10 text-status-red'
      "
      :title="statusTitle"
    >
      {{ statusLabel }}
    </span>
  </div>
</template>
