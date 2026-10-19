<script setup lang="ts">
import { computed, ref } from "vue";
import {
  collectPushActivityFailures,
  getPushActivityTone,
  summarizePushActivities,
} from "#shared/push-activity";
import type { PushLogResponse } from "~/types";

const { data, error, pending, refresh } = await useFetch<PushLogResponse>("/api/push-log");

const activities = computed(() => data.value?.activities ?? []);
const rawCount = computed(() => data.value?.logs.length ?? 0);
const summary = computed(() => summarizePushActivities(activities.value));
const failures = computed(() => collectPushActivityFailures(activities.value));

type Filter = "all" | "failed" | "pending";

const DEFAULT_FILTER: Filter = "failed";

/** 显式选择的筛选；未选择时按数据决定默认视图。 */
const explicitFilter = ref<Filter | null>(null);

const activeFilter = computed<Filter>(() => {
  if (explicitFilter.value) {
    return explicitFilter.value;
  }
  // 默认视图：有失败看失败；只有待确认的问题就看待确认；都正常就展示全部。
  if (summary.value.failedActivityCount > 0) {
    return "failed";
  }
  return summary.value.pendingActivityCount > 0 ? "pending" : "all";
});

const isDefaultFilter = computed(
  () => activeFilter.value === DEFAULT_FILTER && explicitFilter.value === null,
);

function selectFilter(next: Filter) {
  explicitFilter.value = next;
}

const filtered = computed(() => {
  if (activeFilter.value === "all") {
    return activities.value;
  }
  return activities.value.filter((item) => {
    const tone = getPushActivityTone(item);
    return activeFilter.value === "failed" ? tone === "failed" : tone === "pending";
  });
});

const filters = computed(() => [
  { key: "all" as const, label: "全部", count: summary.value.activityCount },
  { key: "failed" as const, label: "未送达", count: summary.value.failedActivityCount },
  { key: "pending" as const, label: "待确认", count: summary.value.pendingActivityCount },
]);

/** 失败明细与活动列表用同一份去重口径。 */
const worstFailures = computed(() => failures.value.slice(0, 8));

const generatedLabel = computed(() => {
  const timestamp = data.value?.generatedAt;
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN");
});
</script>

<template>
  <AppHeader :trail="[{ label: 'NanaBot', to: '/' }, { label: '推送活动' }]">
    <AppRefreshButton :pending="pending" @click="refresh" />
  </AppHeader>

  <div class="mx-auto w-full max-w-3xl flex-1 px-6 py-6">
    <p v-if="error" class="card p-5 text-sm text-status-red">加载失败：{{ error.message }}</p>

    <section v-else class="card p-4">
      <div class="flex items-end justify-between gap-4">
        <div class="min-w-0">
          <h1 class="text-[15px] font-medium tracking-tight text-ink">推送活动</h1>
          <p class="mt-0.5 text-[12px] text-ink-muted">
            同一主播同一次直播的推送已合并，成败按「每个群最后一次送达结果」统计 ·
            {{ rawCount }} 条原始记录
          </p>
        </div>
        <span class="shrink-0 text-[12px] text-ink-muted">{{ generatedLabel }}</span>
      </div>

      <div class="mt-3 grid grid-cols-3 gap-2">
        <div class="rounded bg-recessed px-3 py-2">
          <p class="text-[11px] text-ink-muted">活动</p>
          <p class="mt-0.5 text-[15px] font-medium tabular-nums text-ink">
            {{ summary.activityCount }}
          </p>
        </div>
        <div class="rounded bg-recessed px-3 py-2">
          <p class="text-[11px] text-ink-muted">未送达的群</p>
          <p
            class="mt-0.5 text-[15px] font-medium tabular-nums"
            :class="summary.failedTargetCount > 0 ? 'text-status-red' : 'text-ink'"
          >
            {{ summary.failedTargetCount }}
          </p>
        </div>
        <div class="rounded bg-recessed px-3 py-2">
          <p class="text-[11px] text-ink-muted">待确认的群</p>
          <p
            class="mt-0.5 text-[15px] font-medium tabular-nums"
            :class="summary.pendingTargetCount > 0 ? 'text-status-orange' : 'text-ink'"
          >
            {{ summary.pendingTargetCount }}
          </p>
        </div>
      </div>

      <p
        v-if="summary.failedTargetCount === 0 && summary.pendingTargetCount === 0 && rawCount > 0"
        class="mt-3 text-[12px] text-live"
      >
        最近 {{ summary.activityCount }} 条活动的所有目标群都已送达。
      </p>
    </section>

    <section v-if="worstFailures.length > 0" class="card mt-4 p-4">
      <h2 class="text-[13px] font-medium text-ink">需要处理</h2>
      <p class="mt-0.5 text-[12px] text-ink-muted">
        这些群最终没收到推送；失败后重试成功的群不计入这里。
      </p>
      <ul class="mt-3 divide-y divide-line">
        <li
          v-for="item in worstFailures"
          :key="`${item.activityId}:${item.targetId}`"
          class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-2 text-[12px]"
        >
          <span
            class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium"
            :class="
              item.status === 'failed'
                ? 'bg-status-red/10 text-status-red'
                : 'bg-status-orange/10 text-status-orange'
            "
          >
            {{ item.status === "failed" ? "未送达" : "待确认" }}
          </span>
          <span class="shrink-0 font-medium text-ink">{{ item.target }}</span>
          <span class="min-w-0 truncate text-ink-muted"> {{ item.subject ?? "机器人" }}</span>
          <span class="shrink-0 text-ink-muted">{{ item.purposeLabel }}</span>
          <span class="min-w-0 flex-1 truncate text-ink-secondary">
            {{ item.error ?? "未知错误" }}
          </span>
          <span v-if="item.attemptCount > 1" class="shrink-0 text-ink-muted">
            {{ item.attemptCount }} 次
          </span>
        </li>
      </ul>
    </section>

    <section
      v-if="!error && summary.activityCount > 0"
      class="mt-4 flex flex-wrap items-center gap-1"
    >
      <button
        v-for="item in filters"
        :key="item.key"
        type="button"
        class="rounded px-2.5 py-1 text-[12px] transition-colors focus:outline-none focus-visible:shadow-focus-ring"
        :class="
          activeFilter === item.key
            ? 'bg-ink text-white'
            : 'text-ink-secondary hover:bg-line hover:text-ink'
        "
        :aria-pressed="activeFilter === item.key"
        @click="selectFilter(item.key)"
      >
        {{ item.label }} {{ item.count }}
      </button>
      <button
        v-if="!isDefaultFilter"
        type="button"
        class="ml-auto text-[12px] text-ink-muted hover:text-ink"
        @click="explicitFilter = null"
      >
        恢复默认视图
      </button>
      <span v-else-if="activeFilter !== 'all'" class="ml-auto text-[12px] text-ink-muted">
        {{ activeFilter === "failed" ? "默认只显示未送达的活动" : "默认只显示待确认的活动" }}
      </span>
    </section>

    <section v-else-if="!error" class="card mt-4 p-4">
      <p class="text-[13px] text-ink-muted">暂无推送记录。</p>
    </section>

    <p
      v-if="!error && activities.length > 0 && filtered.length === 0"
      class="mt-4 text-[13px] text-ink-muted"
    >
      没有{{ activeFilter === "failed" ? "未送达" : "待确认" }}的活动。
    </p>

    <ol v-if="filtered.length > 0" class="mt-4">
      <li v-for="(item, index) in filtered" :key="item.id" class="mt-1 first:mt-0">
        <PushActivityItem
          :activity="item"
          show-targets
          :highlight="getPushActivityTone(item) !== 'delivered'"
          :last="index === filtered.length - 1"
        />
      </li>
    </ol>

    <p v-if="data?.truncated" class="mt-2 text-[12px] text-ink-muted">
      仅展示最近 {{ rawCount }} 条原始推送，更早的活动未加载。
    </p>
  </div>
</template>
