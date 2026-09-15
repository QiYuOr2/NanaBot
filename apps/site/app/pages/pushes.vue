<script setup lang="ts">
import { computed } from "vue";
import type { PushLogResponse } from "~/types";

const { data, error, pending, refresh } = await useFetch<PushLogResponse>("/api/push-log");

const activities = computed(() => data.value?.activities ?? []);
const rawCount = computed(() => data.value?.logs.length ?? 0);
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
            同一主播同一次直播的推送已合并，共 {{ activities.length }} 条活动 ·
            {{ rawCount }} 条原始记录
          </p>
        </div>
        <span class="shrink-0 text-[13px] text-ink-muted">{{ activities.length }} 条</span>
      </div>

      <p v-if="activities.length === 0" class="mt-4 text-[13px] text-ink-muted">暂无推送记录。</p>

      <ol v-else class="mt-4">
        <li v-for="(item, index) in activities" :key="item.id">
          <PushActivityItem :activity="item" show-targets :last="index === activities.length - 1" />
        </li>
      </ol>

      <p v-if="data?.truncated" class="mt-2 text-[12px] text-ink-muted">
        仅展示最近 {{ rawCount }} 条原始推送，更早的活动未加载。
      </p>
    </section>
  </div>
</template>
