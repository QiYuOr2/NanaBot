<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DanmuSessionStatsDto, DanmuWordCountDto } from "~/types";

const props = defineProps<{
  /** 详情接口返回的场次统计。 */
  stats: DanmuSessionStatsDto;
  /** Top 词，按词频降序。 */
  topWords: DanmuWordCountDto[];
}>();

/** 默认展示的 Top 词条数。 */
const TOP_WORD_LIMIT = 30;

const expanded = ref(false);

/** 词频柱状条的相对宽度；最高的词占满整行。 */
const maxCount = computed(() => props.topWords[0]?.count ?? 0);

const visibleWords = computed(() =>
  expanded.value ? props.topWords : props.topWords.slice(0, TOP_WORD_LIMIT),
);

const hiddenCount = computed(() => Math.max(0, props.topWords.length - TOP_WORD_LIMIT));

const emptyText = computed(() =>
  props.stats.messageCount === 0 ? "本场没有记录到弹幕。" : "本场弹幕里没有可统计的词语。",
);

// 切换场次后重新折叠，避免上一场的展开状态串到下一场。
watch(
  () => props.topWords,
  () => {
    expanded.value = false;
  },
);

function barWidth(count: number): string {
  if (maxCount.value <= 0) {
    return "0%";
  }
  return `${Math.max(4, Math.round((count / maxCount.value) * 100))}%`;
}
</script>

<template>
  <section class="card p-4">
    <div class="flex items-end justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-[14px] font-medium tracking-tight text-ink">Top 词</h2>
        <p class="mt-0.5 text-[12px] text-ink-muted">
          中文分词后按出现次数排序，已过滤停用词、噪音词与主播名
        </p>
      </div>
      <span class="shrink-0 text-[13px] text-ink-muted">{{ topWords.length }} 个词</span>
    </div>

    <p v-if="topWords.length === 0" class="mt-4 text-[13px] text-ink-muted">
      {{ emptyText }}
    </p>

    <ol v-else class="mt-3 space-y-1">
      <li
        v-for="(item, index) in visibleWords"
        :key="`${item.word}-${index}`"
        class="flex min-w-0 items-center gap-2 text-[13px]"
      >
        <span class="w-6 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink-muted">
          {{ index + 1 }}
        </span>
        <span class="relative block h-6 min-w-0 flex-1 overflow-hidden rounded bg-canvas">
          <span
            class="absolute inset-y-0 left-0 rounded bg-accent/10"
            :style="{ width: barWidth(item.count) }"
          />
          <span class="relative flex h-full items-center px-2">
            <span class="min-w-0 truncate text-ink" :title="item.word">{{ item.word }}</span>
          </span>
        </span>
        <span class="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-ink-muted">
          {{ item.count }}
        </span>
      </li>
    </ol>

    <button
      v-if="hiddenCount > 0"
      type="button"
      class="mt-2 text-[12px] text-accent transition-colors hover:text-accent-dark"
      @click="expanded = !expanded"
    >
      {{ expanded ? "收起" : `展开其余 ${hiddenCount} 个词` }}
    </button>
  </section>
</template>
