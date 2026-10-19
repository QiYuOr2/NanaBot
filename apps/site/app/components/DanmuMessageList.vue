<script setup lang="ts">
import { computed } from "vue";
import type { DanmuMessageDto } from "~/types";

const props = defineProps<{
  /** 最近弹幕，按时间倒序（最新在前）。 */
  messages: DanmuMessageDto[];
  /** 场次总条数；大于 `messages` 长度说明只展示了最近一部分。 */
  totalCount: number;
}>();

const AVATAR_COLORS = [
  "bg-status-pink",
  "bg-status-blue",
  "bg-status-cyan",
  "bg-status-teal",
  "bg-status-orange",
  "bg-status-red",
];

const truncated = computed(() => props.totalCount > props.messages.length);

/** 同一用户的头像颜色保持稳定，便于在长列表里跟读。 */
function avatarColor(userId: string): string {
  let hash = 0;
  for (const char of userId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? "bg-status-blue";
}

function avatarChar(username: string): string {
  return username.charAt(0) || "•";
}

/** 弹幕发送时刻（时:分:秒），日期已由场次头部展示。 */
function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
</script>

<template>
  <section class="card p-4">
    <div class="flex items-end justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-[14px] font-medium tracking-tight text-ink">弹幕记录</h2>
        <p class="mt-0.5 text-[12px] text-ink-muted">最新的弹幕排在最前面</p>
      </div>
      <span class="shrink-0 text-[13px] text-ink-muted">共 {{ totalCount }} 条</span>
    </div>

    <p v-if="messages.length === 0" class="mt-4 text-[13px] text-ink-muted">本场没有记录到弹幕。</p>

    <ol v-else class="mt-3 divide-y divide-line">
      <li
        v-for="message in messages"
        :key="message.id"
        class="flex min-w-0 items-start gap-2 py-1.5"
      >
        <span class="w-14 shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-ink-muted">
          {{ formatClock(message.sentAt) }}
        </span>

        <span
          class="flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
          :class="avatarColor(message.userId)"
        >
          {{ avatarChar(message.username) }}
        </span>

        <span class="min-w-0 flex-1 break-words text-[13px] leading-relaxed">
          <span class="text-ink-muted">{{ message.username }}</span>
          <span class="mx-1 text-ink-muted">：</span>
          <span class="text-ink">{{ message.content }}</span>
        </span>
      </li>
    </ol>

    <p v-if="truncated" class="mt-2 text-[12px] text-ink-muted">
      仅展示最近 {{ messages.length }} 条，其余 {{ totalCount - messages.length }} 条未加载。
    </p>
  </section>
</template>
