<script setup lang="ts">
import { computed, ref } from "vue";
import type { LiveStatusResponse } from "~/types";

const { data, error, pending, refresh } = await useFetch<LiveStatusResponse>("/api/live-status");

const query = ref("");
const sortLive = ref(false);

const filtered = computed(() => {
  const term = query.value.trim().toLowerCase();
  const list = (data.value?.streamers ?? []).filter((item) => {
    if (!term) {
      return true;
    }
    return item.streamer.toLowerCase().includes(term) || String(item.roomId).includes(term);
  });

  if (!sortLive.value) {
    return list;
  }
  return [...list].sort((a, b) => Number(b.live) - Number(a.live));
});

function toggleSort() {
  sortLive.value = !sortLive.value;
}

const generatedLabel = computed(() => {
  const timestamp = data.value?.generatedAt;
  if (!timestamp) {
    return "暂无记录";
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString("zh-CN");
});
</script>

<template>
  <div class="flex min-h-screen bg-canvas font-sans text-ink antialiased">
    <AppSidebar />

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="sticky top-0 z-10 flex h-12 items-center gap-4 bg-surface/90 px-6 shadow-header backdrop-blur">
        <nav class="flex shrink-0 items-center gap-2 text-[13px]">
          <a class="text-ink-muted hover:text-ink" href="#">NanaBot</a>
          <span class="text-ink-muted">/</span>
          <span class="text-ink">概览</span>
          <span class="ml-2 inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
            <span class="size-1.5 rounded-full bg-live" />
            监控中
          </span>
        </nav>

        <div class="ml-auto flex items-center gap-2">
          <div class="relative hidden sm:block">
            <AppIcon name="search"
              class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-ink-muted" />
            <input v-model="query" class="input-search w-56" placeholder="搜索主播" />
          </div>

          <button class="btn-icon" :title="sortLive ? '按直播状态排序' : '排序'" @click="toggleSort">
            <AppIcon name="filter" />
          </button>

          <button class="btn-primary h-8 text-[13px]" :disabled="pending" @click="() => refresh()">
            <span v-if="pending"
              class="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-white/30 border-t-white" />
            {{ pending ? "刷新中..." : "刷新" }}
          </button>
        </div>
      </header>

      <div class="w-full flex-1 px-6 py-6">
        <div class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <aside class="space-y-6">
            <section class="card">
              <header class="flex items-center justify-between border-b border-ink/5 px-4 py-3">
                <h3 class="text-[13px] font-medium text-ink">最近状态</h3>
                <button class="btn-ghost h-7 px-2.5 text-[12px]" :disabled="pending" @click="() => refresh()">
                  更新
                </button>
              </header>

              <ul class="px-4">
                <li class="flex items-center justify-between border-b border-ink/5 py-3 last:border-0">
                  <span class="flex items-center gap-2 text-[13px] text-ink-secondary">
                    <span class="dot bg-accent" />
                    监控主播
                  </span>
                  <span class="font-mono text-[13px] text-ink">{{ data?.total ?? 0 }}</span>
                </li>
                <li class="flex items-center justify-between border-b border-ink/5 py-3 last:border-0">
                  <span class="flex items-center gap-2 text-[13px] text-ink-secondary">
                    <span class="dot bg-live" />
                    直播中
                  </span>
                  <span class="font-mono text-[13px] text-ink">{{ data?.liveCount ?? 0 }}</span>
                </li>
                <li class="flex items-center justify-between border-b border-ink/5 py-3 last:border-0">
                  <span class="flex items-center gap-2 text-[13px] text-ink-secondary">
                    <span class="dot bg-ink-muted" />
                    未开播
                  </span>
                  <span class="font-mono text-[13px] text-ink">
                    {{ (data?.total ?? 0) - (data?.liveCount ?? 0) }}
                  </span>
                </li>
              </ul>
            </section>

            <section class="card">
              <header class="border-b border-ink/5 px-4 py-3">
                <h3 class="text-[13px] font-medium text-ink">提醒</h3>
              </header>
              <div class="px-4 py-4 text-[13px] leading-relaxed text-ink-secondary">
                主播开播 / 下播时，会在配置的 QQ 群内推送通知。
              </div>
            </section>

            <section class="card">
              <header class="border-b border-ink/5 px-4 py-3">
                <h3 class="text-[13px] font-medium text-ink">最近更新</h3>
              </header>
              <div class="px-4 py-4 text-[13px] text-ink-secondary">{{ generatedLabel }}</div>
            </section>
          </aside>

          <section>
            <div class="mb-4 flex items-center justify-between">
              <h2 class="text-[14px] font-medium tracking-tight text-ink">主播</h2>
              <span class="text-[13px] text-ink-muted">{{ filtered.length }} 个</span>
            </div>

            <p v-if="error" class="card p-5 text-sm text-status-red">
              加载失败：{{ error.message }}
            </p>

            <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div v-for="streamer in filtered" :key="streamer.roomId">
                <StreamerCard :status="streamer" />
              </div>
            </div>

            <p v-if="!error && filtered.length === 0" class="mt-6 text-[13px] text-ink-muted">
              {{
                data?.streamers?.length
                  ? "没有匹配的主播。"
                  : "nana.config.yaml 中暂无开启监控的主播。"
              }}
            </p>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
