<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import { LIVE_SUMMARY_DISCLAIMER } from "@nana/constants";
import type { DanmuLiveSummaryDto, DanmuLiveSummaryResponse } from "~/types";

const props = defineProps<{
  /** 当前场次。切场后丢掉上一次的错误提示。 */
  sessionId: number;
  /** 进行中的场次不能生成。 */
  active: boolean;
  /** 已经落库的摘要。正文只在成功时有值。 */
  summary: DanmuLiveSummaryDto;
}>();

const emit = defineEmits<{
  /** 页面补生成后的最新摘要，由父页面写回详情。 */
  updated: [summary: DanmuLiveSummaryDto];
}>();

const pending = shallowRef(false);
const errorMessage = shallowRef<string | null>(null);

watch(
  () => props.sessionId,
  () => {
    errorMessage.value = null;
  },
);

const canGenerate = computed(
  () =>
    !props.active &&
    !pending.value &&
    props.summary.status !== "ok" &&
    props.summary.status !== "empty",
);

const buttonLabel = computed(() => {
  if (pending.value) {
    return "正在生成...";
  }
  if (props.summary.status === "failed") {
    return "重新生成";
  }
  if (props.summary.status === "pending") {
    return "重新尝试";
  }
  return "生成摘要";
});

const body = computed(() => {
  if (props.active) {
    return "本场尚未结束，摘要会在下播后出现。";
  }
  if (props.summary.status === "ok" && props.summary.text) {
    return props.summary.text;
  }
  if (props.summary.status === "empty") {
    return "本场没有记录到弹幕，无法推断。";
  }
  if (props.summary.status === "failed") {
    return "本场摘要没有生成。";
  }
  if (props.summary.status === "pending" || pending.value) {
    return "正在生成摘要…";
  }
  return "本场还没有摘要。";
});

async function generate() {
  if (!canGenerate.value) {
    return;
  }
  pending.value = true;
  errorMessage.value = null;
  try {
    const response = await $fetch<DanmuLiveSummaryResponse>(
      `/api/danmu/${props.sessionId}/summary`,
      {
        method: "POST",
      },
    );
    emit("updated", response.summary);
    errorMessage.value = response.summary.status === "ok" ? null : (response.message ?? null);
  } catch (caught) {
    errorMessage.value = readError(caught);
  } finally {
    pending.value = false;
  }
}

function readError(caught: unknown): string {
  if (typeof caught === "object" && caught !== null) {
    const record = caught as {
      statusMessage?: string;
      data?: { statusMessage?: string; message?: string };
    };
    const message = record.data?.statusMessage || record.data?.message || record.statusMessage;
    if (message) {
      return message;
    }
  }
  return "生成失败，请稍后再试";
}
</script>

<template>
  <section class="card p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-[14px] font-medium tracking-tight text-ink">直播摘要</h2>
        <p class="mt-0.5 text-[12px] text-ink-muted">{{ LIVE_SUMMARY_DISCLAIMER }}</p>
      </div>
      <button
        v-if="canGenerate || pending"
        class="btn-primary h-8 shrink-0 text-[13px]"
        type="button"
        :disabled="pending"
        @click="generate"
      >
        <span
          v-if="pending"
          class="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-white/30 border-t-white"
        />
        {{ buttonLabel }}
      </button>
    </div>

    <p
      class="mt-3 whitespace-pre-wrap break-words text-[14px] leading-6 text-ink"
      :class="summary.status === 'ok' && summary.text ? '' : 'text-ink-muted'"
    >
      {{ body }}
    </p>
    <p v-if="errorMessage" class="mt-2 text-[12px] text-status-red">{{ errorMessage }}</p>
  </section>
</template>
