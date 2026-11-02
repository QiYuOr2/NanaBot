<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import type {
  DanmuLiveSummaryDto,
  DanmuSessionDetailResponse,
  DanmuSessionsResponse,
} from "~/types";

const { data, error, pending, refresh } =
  await useFetch<DanmuSessionsResponse>("/api/danmu/sessions");

const sessions = computed(() => data.value?.sessions ?? []);

/** 选中的场次；默认选中最新一场。 */
const selectedId = shallowRef<number | null>(null);

watch(
  sessions,
  (list) => {
    if (list.length === 0) {
      selectedId.value = null;
      return;
    }
    const exists = list.some((item) => item.id === selectedId.value);
    if (!exists) {
      selectedId.value = list[0]?.id ?? null;
    }
  },
  { immediate: true },
);

/** 详情按选中场次懒加载；这里用 `$fetch` 手动请求，避免同一页面多个 useFetch 的参数联动。 */
const detail = shallowRef<DanmuSessionDetailResponse | null>(null);
const detailPending = shallowRef(false);
const detailError = shallowRef<string | null>(null);

/** 最近一次请求的场次 ID：快速切场时丢弃过期响应，避免旧场次覆盖新场次。 */
let latestRequestId: number | null = null;

async function loadDetail(id: number | null) {
  latestRequestId = id;

  if (id === null) {
    detail.value = null;
    detailError.value = null;
    return;
  }

  detailPending.value = true;
  detailError.value = null;
  try {
    const response = await $fetch<DanmuSessionDetailResponse>(`/api/danmu/${id}`);
    if (latestRequestId === id) {
      detail.value = response;
    }
  } catch (caught) {
    if (latestRequestId === id) {
      detail.value = null;
      detailError.value = caught instanceof Error ? caught.message : "加载失败";
    }
  } finally {
    if (latestRequestId === id) {
      detailPending.value = false;
    }
  }
}

/** 选中场次变化后再拉详情；列表刷新时 `selectedId` 不变则不会重复请求。 */
watch(selectedId, (id) => void loadDetail(id), { immediate: true });

/** 左侧列表点选场次。 */
function onSelect(id: number) {
  selectedId.value = id;
}

const busy = computed(() => pending.value || detailPending.value);

async function refreshAll() {
  await refresh();
  // 列表刷新后如果场次没变（比如仍在直播的那场），也要重新拉一次详情。
  await loadDetail(selectedId.value);
}

/** 场次时间范围：`开播 → 下播`，进行中的场次只显示开播时间。 */
const timeRange = computed(() => {
  const session = detail.value?.session;
  if (!session) {
    return "";
  }
  if (session.active) {
    return `${formatDateTime(session.startedAt)} 开播 · 直播中`;
  }
  return `${formatDateTime(session.startedAt)} → ${formatDateTime(session.endedAt)}`;
});

/** 页面补生成后只更新当前场次的摘要，不重新拉整页详情。 */
function onLiveSummary(summary: DanmuLiveSummaryDto) {
  const current = detail.value;
  if (!current || current.session.id !== selectedId.value) {
    return;
  }
  detail.value = { ...current, liveSummary: summary };
}

function formatDateTime(iso: string | null): string {
  if (!iso) {
    return "—";
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
  <AppHeader :trail="[{ label: 'NanaBot', to: '/' }, { label: '弹幕词云' }]">
    <AppRefreshButton :pending="busy" @click="refreshAll" />
  </AppHeader>

  <div class="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
    <p v-if="error" class="card p-5 text-sm text-status-red">加载失败：{{ error.message }}</p>

    <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
      <aside class="lg:sticky lg:top-16">
        <DanmuSessionList :sessions="sessions" :selected-id="selectedId" @select="onSelect" />
      </aside>

      <div class="min-w-0 space-y-4">
        <p v-if="detailError" class="card p-5 text-sm text-status-red">
          场次详情加载失败：{{ detailError }}
        </p>

        <p v-else-if="detailPending && !detail" class="card p-5 text-[13px] text-ink-muted">
          正在加载场次详情...
        </p>

        <p v-else-if="!detail" class="card p-5 text-[13px] text-ink-muted">
          左侧还没有可查看的场次。主播开播并收到弹幕后，这里会展示对应场次的词云。
        </p>

        <template v-else>
          <section class="card p-4">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="min-w-0">
                <h1
                  class="flex min-w-0 items-center gap-2 text-[15px] font-medium tracking-tight text-ink"
                >
                  <span class="truncate">{{ detail.session.streamer }}</span>
                  <span
                    v-if="detail.session.active"
                    class="shrink-0 rounded bg-live/10 px-1.5 py-0.5 text-[11px] font-medium text-live"
                  >
                    直播中
                  </span>
                  <span
                    v-else-if="detail.session.closeReasonLabel"
                    class="shrink-0 rounded bg-recessed px-1.5 py-0.5 text-[11px] font-medium text-ink-secondary"
                  >
                    {{ detail.session.closeReasonLabel }}
                  </span>
                </h1>
                <p class="mt-0.5 text-[12px] text-ink-muted">{{ timeRange }}</p>
              </div>
              <a
                class="shrink-0 font-mono text-[12px] text-accent hover:underline"
                :href="`https://live.bilibili.com/${detail.session.roomId}`"
                target="_blank"
                rel="noopener"
              >
                房间 {{ detail.session.roomId }}
              </a>
            </div>

            <dl class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <dt class="text-[12px] text-ink-muted">时长</dt>
                <dd class="mt-0.5 font-mono text-[15px] tabular-nums text-ink">
                  {{ detail.stats.durationText }}
                </dd>
              </div>
              <div>
                <dt class="text-[12px] text-ink-muted">弹幕数</dt>
                <dd class="mt-0.5 font-mono text-[15px] tabular-nums text-ink">
                  {{ detail.stats.messageCount }}
                </dd>
              </div>
              <div>
                <dt class="text-[12px] text-ink-muted">参与人数</dt>
                <dd class="mt-0.5 font-mono text-[15px] tabular-nums text-ink">
                  {{ detail.stats.participantCount }}
                </dd>
              </div>
              <div>
                <dt class="text-[12px] text-ink-muted">每分钟</dt>
                <dd class="mt-0.5 font-mono text-[15px] tabular-nums text-ink">
                  {{ detail.stats.messagesPerMinute }}
                </dd>
              </div>
            </dl>

            <div class="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-ink-secondary">
              <span>
                弹幕王：
                <span class="text-ink">
                  {{
                    detail.stats.topChater
                      ? `${detail.stats.topChater.username}（${detail.stats.topChater.count} 条）`
                      : "（无）"
                  }}
                </span>
              </span>
              <span class="min-w-0">
                最高频弹幕：
                <span class="text-ink">
                  {{
                    detail.stats.topRepeated
                      ? `「${detail.stats.topRepeated.content}」× ${detail.stats.topRepeated.count}`
                      : "（无）"
                  }}
                </span>
              </span>
            </div>
          </section>

          <DanmuLiveSummary
            :session-id="detail.session.id"
            :active="detail.session.active"
            :summary="detail.liveSummary"
            @updated="onLiveSummary"
          />

          <DanmuWordCloud :session="detail.session" :stats="detail.stats" />

          <DanmuWordList :stats="detail.stats" :top-words="detail.topWords" />

          <DanmuMessageList :messages="detail.messages" :total-count="detail.stats.messageCount" />
        </template>
      </div>
    </div>
  </div>
</template>
