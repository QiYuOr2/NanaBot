<script setup lang="ts">
import type { MonitorStreamer } from "#shared/monitor";

defineProps<{ streamer: MonitorStreamer }>();

/** 配置状态的小标签：开启用实色，关闭用灰色。 */
const TAG_ON = "rounded bg-live/10 px-1.5 py-0.5 text-[11px] font-medium text-live";
const TAG_OFF = "rounded bg-recessed px-1.5 py-0.5 text-[11px] font-medium text-ink-muted";
</script>

<template>
  <article class="card flex h-full flex-col p-4">
    <div class="flex items-center gap-3">
      <span
        class="flex size-9 shrink-0 items-center justify-center rounded-md bg-canvas text-[14px] font-medium text-ink-secondary"
      >
        {{ streamer.streamer.charAt(0) }}
      </span>

      <div class="min-w-0 flex-1">
        <h3 class="truncate text-[14px] font-medium text-ink">{{ streamer.streamer }}</h3>
        <a
          class="block w-fit max-w-full truncate font-mono text-[13px] text-accent hover:underline"
          :href="`https://live.bilibili.com/${streamer.roomId}`"
          target="_blank"
          rel="noopener"
          :title="`https://live.bilibili.com/${streamer.roomId}`"
        >
          房间 {{ streamer.roomId }}
        </a>
      </div>

      <span :class="streamer.monitored ? TAG_ON : TAG_OFF">
        {{ streamer.monitored ? "监控中" : "未监控" }}
      </span>
    </div>

    <dl class="mt-3 space-y-2 text-[13px]">
      <div class="flex items-center justify-between gap-3">
        <dt class="text-ink-muted">开播通知</dt>
        <dd :class="streamer.notifyEnabled ? 'text-ink' : 'text-ink-muted'">
          {{ streamer.notifyEnabled ? "开启" : "关闭" }}
        </dd>
      </div>

      <div>
        <dt class="text-ink-muted">通知群 · {{ streamer.groups.length }}</dt>
        <dd v-if="streamer.groups.length === 0" class="mt-1 text-ink-muted">未配置通知群</dd>
        <dd v-else class="mt-1.5 flex flex-wrap gap-1.5">
          <span
            v-for="group in streamer.groups"
            :key="group.id"
            class="inline-flex items-center gap-1 rounded bg-recessed px-1.5 py-0.5 text-[12px]"
            :title="`群号 ${group.id}`"
          >
            <span :class="group.fallback ? 'text-ink-muted' : 'text-ink-secondary'">
              {{ group.name }}
            </span>
            <span class="font-mono text-[11px] text-ink-muted">{{ group.id }}</span>
          </span>
        </dd>
      </div>

      <div>
        <dt class="text-ink-muted">开播文案</dt>
        <dd
          v-if="streamer.messageTemplate"
          class="mt-1 break-all rounded bg-canvas px-2 py-1.5 font-mono text-[12px] leading-relaxed text-ink-secondary"
        >
          {{ streamer.messageTemplate }}
        </dd>
        <dd v-else class="mt-1 text-ink-muted">未配置</dd>
      </div>
    </dl>

    <p class="mt-auto pt-3 font-mono text-[11px] text-ink-muted">UID {{ streamer.uid }}</p>
  </article>
</template>
