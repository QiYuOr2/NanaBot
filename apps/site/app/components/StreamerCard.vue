<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { StreamerStatus } from "~/types";

const props = defineProps<{ status: StreamerStatus }>();
const emit = defineEmits<{ refresh: [roomId: number] }>();

const open = ref(false);
const menuRef = ref<HTMLElement | null>(null);

function onDocumentClick(event: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    open.value = false;
  }
}

onMounted(() => document.addEventListener("click", onDocumentClick));
onBeforeUnmount(() => document.removeEventListener("click", onDocumentClick));

function onRefresh() {
  open.value = false;
  emit("refresh", props.status.roomId);
}

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
        class="flex size-9 shrink-0 items-center justify-center rounded-md bg-canvas text-[14px] font-medium text-ink-secondary shadow-border"
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

      <div ref="menuRef" class="relative">
        <button
          class="flex size-7 shrink-0 items-center justify-center rounded text-ink-muted transition-colors hover:bg-line hover:text-ink"
          title="更多"
          @click.stop="open = !open"
        >
          <AppIcon name="more" />
        </button>

        <div
          v-if="open"
          class="absolute right-0 top-full z-30 mt-1 w-44 rounded-lg bg-surface p-1 shadow-border"
          @click.stop
        >
          <button
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink-secondary transition-colors hover:bg-line hover:text-ink"
            @click="onRefresh"
          >
            <span class="shrink-0">↻</span>
            更新直播状态
          </button>
        </div>
      </div>
    </div>

    <div class="mt-3 space-y-1.5">
      <p v-if="status.title" class="truncate text-[13px] text-ink" :title="status.title">
        {{ status.title }}
      </p>

      <div class="flex items-center gap-2 text-[12px] text-ink-muted">
        <span
          v-if="status.area"
          class="rounded bg-recessed px-1.5 py-0.5 font-medium text-ink-secondary"
        >
          {{ status.area }}
        </span>
        <span v-if="status.live && status.viewer != null">{{ status.viewer }} 人气</span>
      </div>

      <p class="text-[12px] text-ink-muted">
        {{ status.live ? "正在直播" : "未开播" }} · 更新于 {{ formatTime(status.updatedAt) }}
      </p>
    </div>
  </article>
</template>
