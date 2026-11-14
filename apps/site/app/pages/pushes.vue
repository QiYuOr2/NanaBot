<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { getPushActivityTone, summarizePushActivities } from "#shared/push-activity";
import { groupActivitiesByDay } from "#shared/push-presentation";
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

/** 每页展示的活动数：一条活动展开后不矮，20 条约两屏，翻页比无限滚动更容易定位。 */
const PAGE_SIZE = 20;

const page = ref(1);
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)));

/** 切换筛选回到第一页；数据刷新让总页数变少时，把当前页收回有效范围。 */
watch(activeFilter, () => {
  page.value = 1;
});
watch(pageCount, (count) => {
  if (page.value > count) {
    page.value = count;
  }
});

const pagedActivities = computed(() =>
  filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
);

/** 当前页按日期分组渲染，长列表里能直接按天定位。 */
const dayGroups = computed(() => groupActivitiesByDay(pagedActivities.value));

const rangeLabel = computed(() => {
  if (filtered.value.length === 0) {
    return "";
  }
  const start = (page.value - 1) * PAGE_SIZE + 1;
  const end = Math.min(filtered.value.length, page.value * PAGE_SIZE);
  return `第 ${start}–${end} 条，共 ${filtered.value.length} 条`;
});

/** 页码按钮：页数少时全列，多时只保留当前页附近与首尾，中间用省略号。 */
const pageItems = computed(() => {
  const count = pageCount.value;
  const current = page.value;
  if (count <= 7) {
    return Array.from({ length: count }, (_, index) => index + 1);
  }
  const pages = [1, current - 1, current, current + 1, count].filter(
    (value, index, list) => value >= 1 && value <= count && list.indexOf(value) === index,
  );
  const items: (number | "…")[] = [];
  for (const value of pages) {
    const previous = items[items.length - 1];
    if (typeof previous === "number" && value - previous > 1) {
      items.push("…");
    }
    items.push(value);
  }
  return items;
});

const listTop = ref<HTMLElement | null>(null);

function goToPage(next: number) {
  const target = Math.min(Math.max(1, next), pageCount.value);
  if (target === page.value) {
    return;
  }
  page.value = target;
  // 翻页后回到列表顶部，从新一页的第一条开始读。
  listTop.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}

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
            同一次直播，以及同一次任务里紧挨着发出的消息，已合并。成败按每个群的最终结果统计 ·
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
      <span v-if="rangeLabel" class="ml-auto text-[12px] text-ink-muted">{{ rangeLabel }}</span>
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

    <div v-if="dayGroups.length > 0" ref="listTop" class="scroll-mt-4">
      <section v-for="group in dayGroups" :key="group.key" class="mt-5 first:mt-4">
        <h2 class="flex items-center gap-3 text-[12px] font-medium text-ink-secondary">
          <span class="shrink-0">{{ group.label }}</span>
          <span class="h-px flex-1 bg-line" aria-hidden="true" />
          <span class="shrink-0 font-normal text-ink-muted">{{ group.items.length }} 条</span>
        </h2>
        <ol class="mt-2">
          <li v-for="(item, index) in group.items" :key="item.id" class="mt-1 first:mt-0">
            <PushActivityItem
              :activity="item"
              show-targets
              :highlight="getPushActivityTone(item) !== 'delivered'"
              :last="index === group.items.length - 1"
            />
          </li>
        </ol>
      </section>
    </div>

    <nav
      v-if="pageCount > 1"
      class="mt-6 flex flex-wrap items-center justify-center gap-1"
      aria-label="分页"
    >
      <button
        type="button"
        class="rounded px-2.5 py-1 text-[12px] text-ink-secondary transition-colors hover:bg-line hover:text-ink focus:outline-none focus-visible:shadow-focus-ring disabled:pointer-events-none disabled:opacity-40"
        :disabled="page === 1"
        @click="goToPage(page - 1)"
      >
        上一页
      </button>
      <template v-for="(item, index) in pageItems" :key="`${item}-${index}`">
        <span v-if="item === '…'" class="px-1 text-[12px] text-ink-muted" aria-hidden="true">
          …
        </span>
        <button
          v-else
          type="button"
          class="min-w-7 rounded px-2 py-1 text-center text-[12px] transition-colors focus:outline-none focus-visible:shadow-focus-ring"
          :class="
            item === page ? 'bg-ink text-white' : 'text-ink-secondary hover:bg-line hover:text-ink'
          "
          :aria-current="item === page ? 'page' : undefined"
          @click="goToPage(item)"
        >
          {{ item }}
        </button>
      </template>
      <button
        type="button"
        class="rounded px-2.5 py-1 text-[12px] text-ink-secondary transition-colors hover:bg-line hover:text-ink focus:outline-none focus-visible:shadow-focus-ring disabled:pointer-events-none disabled:opacity-40"
        :disabled="page === pageCount"
        @click="goToPage(page + 1)"
      >
        下一页
      </button>
    </nav>

    <p v-if="data?.truncated" class="mt-2 text-[12px] text-ink-muted">
      仅展示最近 {{ rawCount }} 条原始推送，更早的活动未加载。
    </p>
  </div>
</template>
