<script setup lang="ts">
import { computed } from "vue";
import type { DanmuSessionSummaryDto } from "~/types";

const props = defineProps<{
  /** 按开始时间倒序的场次列表。 */
  sessions: DanmuSessionSummaryDto[];
  /** 当前选中的场次 ID。 */
  selectedId: number | null;
}>();

const emit = defineEmits<{ select: [id: number] }>();

const TAG_CLASS = "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium";

const liveCount = computed(() => props.sessions.filter((session) => session.active).length);

/** 场次开始时间：同年显示月/日/时/分，跨年补上年份。 */
function formatStartedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat("zh-CN", {
    ...(sameYear ? {} : { year: "numeric" }),
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** 进行中的场次时长会持续增长，这里显示「已直播 …」。 */
function durationLabel(session: DanmuSessionSummaryDto): string {
  return session.active ? `已直播 ${session.durationText}` : session.durationText;
}

function topWordsLabel(session: DanmuSessionSummaryDto): string {
  if (session.topWords.length === 0) {
    return session.msgCount === 0 ? "本场没有弹幕" : "Top 词未加载";
  }
  return session.topWords
    .slice(0, 5)
    .map((item) => item.word)
    .join(" · ");
}
</script>

<template>
  <section class="card flex h-full flex-col p-4">
    <div class="flex items-end justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-[14px] font-medium tracking-tight text-ink">历史场次</h2>
        <p class="mt-0.5 text-[12px] text-ink-muted">按开播时间倒序</p>
      </div>
      <span class="shrink-0 text-[13px] text-ink-muted">{{ sessions.length }} 场</span>
    </div>

    <p v-if="liveCount > 0" class="mt-2 text-[12px] text-ink-muted">
      其中 {{ liveCount }} 场仍在直播中。
    </p>

    <p v-if="sessions.length === 0" class="mt-4 text-[13px] text-ink-muted">
      暂无弹幕记录。主播开播并收到弹幕后，这里会出现对应场次。
    </p>

    <ul v-else class="mt-3 space-y-1.5">
      <li v-for="session in sessions" :key="session.id">
        <button
          type="button"
          class="w-full rounded-md px-2 py-2 text-left transition-colors"
          :class="
            session.id === selectedId
              ? 'bg-line'
              : 'hover:bg-canvas focus:outline-none focus-visible:shadow-focus-ring'
          "
          :aria-pressed="session.id === selectedId"
          @click="emit('select', session.id)"
        >
          <div class="flex min-w-0 items-center gap-2">
            <span
              class="dot"
              :class="session.active ? 'bg-live' : 'bg-ink-muted'"
              :title="session.active ? '直播中' : (session.closeReasonLabel ?? '已结束')"
            />
            <span class="min-w-0 flex-1 truncate text-[13px] text-ink">
              {{ session.streamer }}
            </span>
            <span v-if="session.active" :class="`${TAG_CLASS} bg-live/10 text-live`"> 直播中 </span>
            <span
              v-else-if="session.closeReason"
              :class="`${TAG_CLASS} bg-recessed text-ink-secondary`"
            >
              {{ session.closeReasonLabel }}
            </span>
          </div>

          <div class="mt-1 flex min-w-0 items-baseline justify-between gap-2 text-[12px]">
            <span class="min-w-0 truncate text-ink-muted">
              {{ formatStartedAt(session.startedAt) }}
            </span>
            <span class="shrink-0 tabular-nums text-ink-muted">{{ durationLabel(session) }}</span>
          </div>

          <div class="mt-0.5 flex min-w-0 items-baseline justify-between gap-2 text-[12px]">
            <span class="min-w-0 truncate text-ink-secondary" :title="topWordsLabel(session)">
              {{ topWordsLabel(session) }}
            </span>
            <span class="shrink-0 tabular-nums text-ink-muted">
              {{ session.msgCount }} 条 · {{ session.participantCount }} 人
            </span>
          </div>
        </button>
      </li>
    </ul>
  </section>
</template>
