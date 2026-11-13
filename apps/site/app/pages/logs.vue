<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from "vue";
import { parseProjectLogRows } from "#shared/log-presentation";
import type { ProjectLogsResponse } from "#shared/logs";

useHead({ title: "项目日志 · NanaBot" });
const file = ref("");
const lines = ref(500);
const query = computed(() => ({ file: file.value || undefined, lines: lines.value }));
const { data, error, pending, refresh } = await useFetch<ProjectLogsResponse>("/api/logs", {
  query,
  watch: false,
});
const viewport = useTemplateRef<HTMLElement>("viewport");
const logRows = computed(() => parseProjectLogRows(data.value?.content ?? ""));

async function scrollToLatest() {
  await nextTick();
  const element = viewport.value;
  if (!element) return;
  element.scrollTop = element.scrollHeight;
  requestAnimationFrame(() => {
    if (viewport.value === element) element.scrollTop = element.scrollHeight;
  });
}

onMounted(() => void scrollToLatest());
watch(data, () => void scrollToLatest(), { flush: "post" });

async function load() {
  await refresh();
}
function formatSize(size: number) {
  return size < 1024
    ? `${size} B`
    : size < 1024 ** 2
      ? `${(size / 1024).toFixed(1)} KiB`
      : `${(size / 1024 ** 2).toFixed(1)} MiB`;
}
</script>

<template>
  <AppHeader :trail="[{ label: 'NanaBot', to: '/' }, { label: '项目日志' }]">
    <AppRefreshButton :pending="pending" @click="load" />
  </AppHeader>
  <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
    <h1 class="text-[22px] font-semibold tracking-tight">项目日志</h1>
    <p class="mt-2 text-[13px] text-ink-secondary">
      查看 logs/ 中的应用与账号日志，点击刷新获取最新内容。
    </p>
    <form class="card mt-5 flex flex-wrap items-end gap-4 p-4" @submit.prevent="load">
      <div class="min-w-0 flex-1">
        <label for="log-file" class="text-[12px] text-ink-secondary">日志文件</label>
        <select
          id="log-file"
          v-model="file"
          class="input mt-1.5 w-full"
          :disabled="pending"
          @change="load"
        >
          <option value="">最新日志</option>
          <option v-for="item in data?.files ?? []" :key="item.name" :value="item.name">
            {{ item.name }} · {{ formatSize(item.size) }}
          </option>
        </select>
      </div>
      <div>
        <label for="log-lines" class="text-[12px] text-ink-secondary">末尾行数</label>
        <select
          id="log-lines"
          v-model="lines"
          class="input mt-1.5 w-full"
          :disabled="pending"
          @change="load"
        >
          <option v-for="count in [100, 500, 1000, 2000]" :key="count" :value="count">
            {{ count }} 行
          </option>
        </select>
      </div>
    </form>
    <p v-if="error" role="alert" class="card mt-4 p-4 text-sm text-status-red">
      日志加载失败：{{ error.message }}
    </p>
    <section v-else-if="data" class="card mt-4 overflow-hidden">
      <div
        class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 text-[12px] text-ink-muted"
      >
        <span class="font-mono">{{ data.selected ?? "暂无日志文件" }}</span>
        <span>{{ new Date(data.generatedAt).toLocaleString("zh-CN", { hour12: false }) }}</span>
      </div>
      <p
        v-if="data.truncated"
        class="border-b border-line px-4 py-2 text-[12px] text-status-orange"
      >
        仅展示文件末尾，单次最多读取 256 KiB。
      </p>
      <div
        v-if="data.content"
        ref="viewport"
        class="max-h-[70dvh] overflow-auto bg-[#171717] p-4 font-mono text-[12px] leading-5 text-[#ededed]"
        tabindex="0"
        role="log"
        aria-label="日志内容"
      >
        <template v-for="(row, index) in logRows" :key="index">
          <div v-if="row.timestamp" class="flex min-w-0 items-start gap-2 py-0.5">
            <div
              class="flex shrink-0 flex-row items-start gap-2 max-sm:w-[9.25rem] max-sm:flex-col max-sm:gap-1"
            >
              <span :class="row.timestampClass">{{ row.timestamp }}</span>
              <span :class="row.levelClass">{{ row.levelText }}</span>
              <span :class="row.sourceClass" :title="row.source ?? undefined">{{ row.source }}</span>
            </div>
            <span class="min-w-0 flex-1 whitespace-pre-wrap break-words">{{ row.message }}</span>
          </div>
          <div
            v-else
            class="whitespace-pre-wrap break-words py-0.5 pl-2 text-[#bdbdbd] max-sm:pl-[9.75rem]"
          >
            {{ row.message }}
          </div>
        </template>
      </div>
      <p v-else class="p-5 text-[13px] text-ink-muted">
        {{ data.selected ? "日志文件为空。" : "logs/ 下暂无可读取的日志。" }}
      </p>
    </section>
  </main>
</template>
