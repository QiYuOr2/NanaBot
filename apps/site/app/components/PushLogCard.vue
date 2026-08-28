<script setup lang="ts">
import { computed, ref } from "vue";
import type { PushLogItem } from "~/types";

const props = defineProps<{ items: PushLogItem[] }>();

const expanded = ref(false);

const visibleItems = computed(() => (expanded.value ? props.items : props.items.slice(0, 5)));

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

function avatarColor(item: PushLogItem): string {
  const key = item.subject || item.target;
  let hash = 0;
  for (const ch of key) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function avatarChar(item: PushLogItem): string {
  const key = item.subject || item.target;
  return key.charAt(0) || "•";
}

function displayTitle(item: PushLogItem): string {
  return item.content?.trim() || item.subject || item.purposeLabel;
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

function toggleExpanded() {
  expanded.value = !expanded.value;
}
</script>

<template>
  <section class="card flex h-full flex-col p-4">
    <div class="flex items-start justify-between">
      <div>
        <h2 class="text-[14px] font-medium tracking-tight text-ink">最近推送活动</h2>
        <p class="mt-0.5 text-[12px] text-ink-muted">时间轴视图</p>
      </div>
      <button
        class="text-[13px] text-accent transition-colors hover:text-accent-dark"
        @click="toggleExpanded"
      >
        {{ expanded ? "收起" : "查看全部" }}
      </button>
    </div>

    <p v-if="items.length === 0" class="mt-4 text-[13px] text-ink-muted">暂无推送记录。</p>

    <ol v-else class="mt-3">
      <li v-for="(item, index) in visibleItems" :key="item.id" class="flex gap-3">
        <span
          class="w-16 shrink-0 whitespace-nowrap pt-1 text-right text-[12px] tabular-nums text-ink-muted"
        >
          {{ relativeTime(item.pushedAt) }}
        </span>

        <div class="flex flex-col items-center">
          <span
            class="mt-1.5 size-2.5 shrink-0 rounded-full"
            :class="item.success ? 'bg-live' : 'bg-status-red'"
          />
          <span
            v-if="index < visibleItems.length - 1"
            class="mt-1 w-px flex-1 bg-line"
            aria-hidden="true"
          />
        </div>

        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
          :class="avatarColor(item)"
        >
          {{ avatarChar(item) }}
        </span>

        <div class="min-w-0 flex-1 pb-4">
          <div class="flex min-w-0 items-center gap-2 text-[13px] leading-snug text-ink">
            <span
              class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium"
              :class="PURPOSE_TAG[item.purpose] ?? PURPOSE_TAG.notification"
            >
              {{ item.purposeLabel }}
            </span>
            <span class="min-w-0 truncate">{{ displayTitle(item) }}</span>
          </div>
          <div class="mt-1 flex min-w-0 items-center gap-1 text-[12px] text-ink-muted">
            <span class="shrink-0">→</span>
            <span class="min-w-0 truncate">{{ item.target }}</span>
          </div>
        </div>

        <span
          class="shrink-0 self-start rounded px-1.5 py-0.5 text-[11px] font-medium"
          :class="item.success ? 'bg-live/10 text-live' : 'bg-status-red/10 text-status-red'"
          :title="item.error ?? ''"
        >
          {{ item.success ? "已送达" : "失败" }}
        </span>
      </li>
    </ol>
  </section>
</template>
