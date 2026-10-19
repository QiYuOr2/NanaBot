<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { danmuWordCloudSrcPath } from "#shared/danmu";
import type { DanmuSessionStatsDto, DanmuSessionSummaryDto, DanmuWordCloudFormat } from "~/types";

const props = defineProps<{
  /** 当前选中的场次。 */
  session: DanmuSessionSummaryDto;
  /** 场次统计，用于判断是否有弹幕可画。 */
  stats: DanmuSessionStatsDto;
}>();

/** 默认用 PNG（与推送词云一致）；PNG 渲染失败时降级为 SVG 文本，避免整块空白。 */
const format = ref<DanmuWordCloudFormat>("png");

// 词云图内容随场次变化，切场后重新从 PNG 尝试。
watch(
  () => props.session.id,
  () => {
    format.value = "png";
  },
);

const imageSrc = computed(() => {
  const path = danmuWordCloudSrcPath(props.session.id, format.value);
  // 进行中的场次仍会追加弹幕，带上条数作为缓存键，刷新后能拿到新的图。
  if (!props.session.active) {
    return path;
  }
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}v=${props.stats.messageCount}`;
});

const href = computed(() => danmuWordCloudSrcPath(props.session.id, "png"));

const hasMessages = computed(() => props.stats.messageCount > 0);

function onImageError() {
  if (format.value === "png") {
    format.value = "svg";
  }
}
</script>

<template>
  <section class="card overflow-hidden">
    <div class="flex flex-wrap items-center justify-between gap-2 p-4 pb-3">
      <div class="min-w-0">
        <h2 class="text-[14px] font-medium tracking-tight text-ink">词云图</h2>
        <p class="mt-0.5 text-[12px] text-ink-muted">
          与推送到管理员群的图片使用同一套渲染；最多展示 60 个高频词
        </p>
      </div>
      <span v-if="format === 'svg'" class="shrink-0 text-[12px] text-status-orange">
        PNG 渲染失败，已降级为 SVG
      </span>
    </div>

    <p v-if="!hasMessages" class="px-4 pb-5 text-[13px] text-ink-muted">
      本场没有记录到弹幕，无法生成词云图。
    </p>

    <a
      v-else
      class="block bg-[#16181d]"
      :href="href"
      target="_blank"
      rel="noopener"
      title="在新窗口打开原图"
    >
      <img
        :key="imageSrc"
        :src="imageSrc"
        :alt="`${session.streamer} 本场弹幕词云`"
        width="1000"
        height="620"
        loading="lazy"
        class="block h-auto w-full"
        @error="onImageError"
      />
    </a>
  </section>
</template>
