<script setup lang="ts">
import { computed, ref } from "vue";
import type { MonitorResponse } from "#shared/monitor";

const { data, error, pending, refresh } = await useFetch<MonitorResponse>("/api/monitor");

type Filter = "all" | "monitored" | "idle";

const activeFilter = ref<Filter>("all");

const streamers = computed(() => data.value?.streamers ?? []);
const summary = computed(() => data.value?.summary);

const filters = computed(() => {
  const counts = summary.value;
  return [
    { key: "all" as const, label: "全部", count: counts?.streamerCount ?? 0 },
    { key: "monitored" as const, label: "监控中", count: counts?.monitoredCount ?? 0 },
    {
      key: "idle" as const,
      label: "未监控",
      count: (counts?.streamerCount ?? 0) - (counts?.monitoredCount ?? 0),
    },
  ];
});

const filtered = computed(() => {
  if (activeFilter.value === "all") {
    return streamers.value;
  }
  const monitored = activeFilter.value === "monitored";
  return streamers.value.filter((item) => item.monitored === monitored);
});

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
  <AppHeader :trail="[{ label: 'NanaBot', to: '/' }, { label: '直播监控' }]">
    <AppRefreshButton :pending="pending" @click="refresh" />
  </AppHeader>

  <div class="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
    <p v-if="error" class="card p-5 text-sm text-status-red">加载失败：{{ error.message }}</p>

    <template v-else>
      <section class="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div class="card p-4">
          <h3 class="text-[13px] font-medium text-ink">主播</h3>
          <p class="mt-2 font-mono text-[26px] font-semibold leading-none tracking-tight text-ink">
            {{ summary?.streamerCount ?? 0 }}
          </p>
          <p class="mt-1 text-[12px] text-ink-muted">配置中的全部主播</p>
        </div>
        <div class="card p-4">
          <h3 class="text-[13px] font-medium text-ink">监控中</h3>
          <p class="mt-2 font-mono text-[26px] font-semibold leading-none tracking-tight text-ink">
            {{ summary?.monitoredCount ?? 0 }}
          </p>
          <p class="mt-1 text-[12px] text-ink-muted">live 开启，bot 会轮询</p>
        </div>
        <div class="card p-4">
          <h3 class="text-[13px] font-medium text-ink">会推送通知</h3>
          <p class="mt-2 font-mono text-[26px] font-semibold leading-none tracking-tight text-ink">
            {{ summary?.notifyingCount ?? 0 }}
          </p>
          <p class="mt-1 text-[12px] text-ink-muted">开播 / 下播发到 QQ 群</p>
        </div>
        <div class="card p-4">
          <h3 class="text-[13px] font-medium text-ink">通知群</h3>
          <p class="mt-2 font-mono text-[26px] font-semibold leading-none tracking-tight text-ink">
            {{ summary?.groupCount ?? 0 }}
          </p>
          <p class="mt-1 text-[12px] text-ink-muted">全部主播去重</p>
        </div>
      </section>

      <section
        v-if="(summary?.streamerCount ?? 0) > 0"
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
        <span class="ml-auto text-[12px] text-ink-muted">{{ generatedLabel }}</span>
      </section>

      <p v-if="streamers.length === 0" class="card mt-4 p-5 text-[13px] text-ink-muted">
        nana.config.yaml 里还没有主播。在 up 列表里加上主播后，这里会显示每个主播的监控与通知配置。
      </p>

      <p v-else-if="filtered.length === 0" class="mt-4 text-[13px] text-ink-muted">
        没有{{ activeFilter === "monitored" ? "正在监控" : "未监控" }}的主播。
      </p>

      <div v-else class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MonitorStreamerCard
          v-for="streamer in filtered"
          :key="`${streamer.uid}-${streamer.roomId}`"
          :streamer="streamer"
        />
      </div>

      <p class="mt-4 text-[12px] leading-relaxed text-ink-muted">
        只读视图，改配置需要直接编辑
        nana.config.yaml。群昵称取自最近的推送记录，没推送过的群显示为「群 + 群号」。
      </p>
    </template>
  </div>
</template>
