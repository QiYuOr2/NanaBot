<script setup lang="ts">
import { computed } from "vue";
import {
  getActivityStatusView,
  getTargetStatusView,
  PUSH_STATUS_CHIP_CLASS,
  PUSH_STATUS_DOT_CLASS,
  summarizeTargets,
} from "#shared/push-presentation";
import type { PushActivity } from "~/types";

const props = withDefaults(
  defineProps<{
    /** 已经按「同一次直播」合并好的推送活动。 */
    activity: PushActivity;
    /** 是否是时间轴的最后一条，用于隐藏连线。 */
    last?: boolean;
    /** 是否展开该活动下的每个目标群明细。 */
    showTargets?: boolean;
    /** 是否需要关注的视觉强调（失败 / 待确认的活动）。 */
    highlight?: boolean;
  }>(),
  { last: false, showTargets: false, highlight: false },
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
  wordcloud: "bg-status-orange/10 text-status-orange",
  "live.summary": "bg-status-teal/10 text-status-teal",
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

const isBotActivity = computed(() => !props.activity.subject);
/** 机器人推送没有主播名，标题直接说明是机器人；具体内容在下一行。 */
const title = computed(() => props.activity.subject?.trim() || "机器人");

const status = computed(() => getActivityStatusView(props.activity));
const targetSummary = computed(() => summarizeTargets(props.activity));
const targetViews = computed(() =>
  props.activity.targets.map((target) => ({ target, view: getTargetStatusView(target) })),
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

/** 悬浮时展示精确时间。 */
function absoluteTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("zh-CN");
}
</script>

<template>
  <div class="rounded-lg transition-colors" :class="highlight ? 'bg-recessed/70' : ''">
    <div class="flex gap-3 px-2 py-1">
      <time
        class="w-16 shrink-0 whitespace-nowrap pt-1 text-right text-[12px] tabular-nums text-ink-muted"
        :datetime="activity.latestAt"
        :title="absoluteTime(activity.latestAt)"
      >
        {{ relativeTime(activity.latestAt) }}
      </time>

      <div class="flex flex-col items-center">
        <span
          class="mt-1.5 size-2.5 shrink-0 rounded-full"
          :class="PUSH_STATUS_DOT_CLASS[status.tone]"
          :aria-label="status.label"
        />
        <span v-if="!last" class="mt-1 w-px flex-1 bg-line" aria-hidden="true" />
      </div>

      <span
        class="flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
        :class="avatarColor"
        :aria-hidden="true"
      >
        {{ avatarChar }}
      </span>

      <div class="min-w-0 flex-1 pb-4">
        <div
          class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-snug text-ink"
        >
          <span
            class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium"
            :class="PURPOSE_TAG[activity.purpose] ?? PURPOSE_TAG.notification"
          >
            {{ activity.purposeLabel }}
          </span>
          <span class="min-w-0 truncate font-medium">{{ title }}</span>
        </div>

        <p
          v-if="activity.content"
          class="mt-1 line-clamp-2 text-[12px] leading-relaxed text-ink-secondary"
        >
          {{ activity.content }}
        </p>

        <div class="mt-1 flex min-w-0 items-center gap-1 text-[12px] text-ink-muted">
          <span class="shrink-0" aria-hidden="true">→</span>
          <span class="min-w-0 truncate">{{ targetSummary }}</span>
          <span
            v-if="activity.retryCount > 0"
            class="shrink-0 rounded bg-recessed px-1.5 py-0.5 text-[11px]"
            :title="`${activity.retryCount} 个群推送过多次`"
          >
            重试 {{ activity.retryCount }}
          </span>
          <!-- 不展开明细时，没重试的活动把送达状态放在这里，不必滑到最右才看得到。 -->
          <span
            v-if="!showTargets && activity.retryCount === 0"
            class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium"
            :class="PUSH_STATUS_CHIP_CLASS[status.tone]"
            :title="status.title"
          >
            {{ status.label }}
          </span>
        </div>

        <ul v-if="showTargets" class="mt-2 space-y-1.5 border-l border-line pl-3">
          <li
            v-for="{ target, view } in targetViews"
            :key="target.targetId"
            class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-muted"
          >
            <span class="min-w-0 truncate">{{ target.target }}</span>
            <span
              class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium"
              :class="PUSH_STATUS_CHIP_CLASS[view.tone]"
              :title="view.detail"
            >
              {{ view.label }}
            </span>
            <span v-if="view.retried" class="min-w-0 flex-1 truncate text-[11px]">
              {{ view.detail }}
            </span>
            <span v-else-if="view.tone !== 'success'" class="min-w-0 truncate text-[11px]">
              {{ view.detail }}
            </span>
          </li>
        </ul>
      </div>

      <span
        v-if="showTargets || activity.retryCount > 0"
        class="flex shrink-0 flex-col items-end gap-1 self-start"
      >
        <span
          class="rounded px-1.5 py-0.5 text-[11px] font-medium"
          :class="PUSH_STATUS_CHIP_CLASS[status.tone]"
          :title="status.title"
        >
          {{ status.label }}
        </span>
        <span v-if="status.retried" class="text-[11px] text-ink-muted" :title="status.title">
          重试后送达
        </span>
      </span>
    </div>
  </div>
</template>
