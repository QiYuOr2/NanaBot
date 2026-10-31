<script setup lang="ts">
import { computed, ref } from "vue";
import { getPushActivityTone, summarizePushActivities } from "#shared/push-activity";
import type { PushLogResponse } from "~/types";

const { data, error, pending, refresh } = await useFetch<PushLogResponse>("/api/push-log");

const activities = computed(() => data.value?.activities ?? []);
const rawCount = computed(() => data.value?.logs.length ?? 0);
const summary = computed(() => summarizePushActivities(activities.value));

type Filter = "all" | "failed" | "pending";

/** 页面本质是推送日志，默认看全部；筛选只在想排查时手动点。 */
const activeFilter = ref<Filter>("all");

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
        @click="activeFilter = item.key"
      >
        {{ item.label }} {{ item.count }}
      </button>
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
