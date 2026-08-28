<script setup lang="ts">
import type { StreamerStatus } from "~/types";

defineProps<{ status: StreamerStatus }>();

function formatTime(iso: string | null): string {
  if (!iso) {
    return "暂无记录";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
</script>

<template>
  <article class="card flex h-full flex-col p-4 transition hover:shadow-card-hover">
    <div class="flex items-center gap-3">
      <span
        class="flex size-9 shrink-0 items-center justify-center rounded-md bg-canvas text-[14px] font-medium text-ink-secondary"
      >
        {{ status.streamer.charAt(0) }}
      </span>

      <div class="min-w-0 flex-1">
        <h3 class="truncate text-[14px] font-medium text-ink">{{ status.streamer }}</h3>
        <a
          class="block w-fit max-w-full truncate font-mono text-[13px] text-accent hover:underline"
          :href="`https://live.bilibili.com/${status.roomId}`"
          target="_blank"
          rel="noopener"
          :title="`https://live.bilibili.com/${status.roomId}`"
        >
          {{ status.roomId }}
        </a>
      </div>

      <span class="dot" :class="status.live ? 'bg-live' : 'bg-ink-muted'" />
      <button
        class="flex size-7 shrink-0 items-center justify-center rounded text-ink-muted transition-colors hover:bg-line hover:text-ink"
        title="更多"
      >
        <AppIcon name="more" />
      </button>
    </div>

    <p class="mt-3 text-[12px] text-ink-muted">
      {{ status.live ? "正在直播" : "未开播" }} · 更新于 {{ formatTime(status.updatedAt) }}
    </p>
  </article>
</template>
