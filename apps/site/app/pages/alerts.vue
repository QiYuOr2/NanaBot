<script setup lang="ts">
import { computed, ref } from "vue";
import type { BotAlertsResponse } from "#shared/alerts";

const { data, error, pending, refresh } = await useFetch<BotAlertsResponse>("/api/alerts");

type Filter = "all" | "offline" | "recovered";

const activeFilter = ref<Filter>("all");

const alerts = computed(() => data.value?.alerts ?? []);
const state = computed(() => data.value?.state ?? null);

const filtered = computed(() => {
  if (activeFilter.value === "all") {
    return alerts.value;
  }
  return alerts.value.filter((item) => item.kind === activeFilter.value);
});

const filters = computed(() => [
  { key: "all" as const, label: "全部", count: alerts.value.length },
  {
    key: "offline" as const,
    label: "离线",
    count: alerts.value.filter((item) => item.kind === "offline").length,
  },
  {
    key: "recovered" as const,
    label: "恢复",
    count: alerts.value.filter((item) => item.kind === "recovered").length,
  },
]);

const statusLabel = computed(() => {
  if (!state.value) {
    return "尚未记录";
  }
  return state.value.online ? "在线" : "离线";
});

const statusDetail = computed(() => {
  const current = state.value;
  if (!current) {
    return "机器人启动并完成一次检测后，这里会显示在线或离线。";
  }
  if (!current.online && current.offlineSince) {
    return `自 ${formatTime(current.offlineSince)} 起离线`;
  }
  if (current.lastOnlineAlertAt) {
    return `最近一次恢复于 ${formatTime(current.lastOnlineAlertAt)}`;
  }
  return "当前连接正常";
});

const statusDot = computed(() => {
  if (!state.value) {
    return "bg-ink-muted";
  }
  return state.value.online ? "bg-live" : "bg-status-red";
});

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("zh-CN");
}
</script>

<template>
  <AppHeader :trail="[{ label: 'NanaBot', to: '/' }, { label: '告警' }]">
    <AppRefreshButton :pending="pending" @click="refresh" />
  </AppHeader>

  <div class="mx-auto w-full max-w-3xl flex-1 px-6 py-6">
    <p v-if="error" class="card p-5 text-sm text-status-red">加载失败：{{ error.message }}</p>

    <template v-else>
      <section class="card p-4">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h1 class="text-[15px] font-medium tracking-tight text-ink">告警</h1>
            <p class="mt-0.5 text-[12px] text-ink-muted">
              机器人掉线和恢复。邮件、Bark 与这里是同一条记录。
            </p>
          </div>
          <p class="flex shrink-0 items-center gap-1.5 text-[13px] text-ink">
            <span class="size-1.5 rounded-full" :class="statusDot" />
            {{ statusLabel }}
          </p>
        </div>
        <p class="mt-2 text-[12px] text-ink-secondary">{{ statusDetail }}</p>
      </section>

      <section v-if="alerts.length > 0" class="mt-4 flex flex-wrap items-center gap-1">
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

      <section v-else class="card mt-4 p-4">
        <p class="text-[13px] text-ink-muted">暂无离线告警。</p>
      </section>

      <p v-if="alerts.length > 0 && filtered.length === 0" class="mt-4 text-[13px] text-ink-muted">
        没有{{ activeFilter === "offline" ? "离线" : "恢复" }}记录。
      </p>

      <ol v-if="filtered.length > 0" class="card mt-4 px-4 pt-4">
        <li v-for="(item, index) in filtered" :key="item.id">
          <OfflineAlertItem :alert="item" :last="index === filtered.length - 1" />
        </li>
      </ol>
    </template>
  </div>
</template>
