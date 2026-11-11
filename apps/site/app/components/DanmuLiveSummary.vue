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

/** 重新生成是测试入口，允许按浏览器隐藏；默认显示，隐藏后保留一个「···」恢复入口。 */
const regenerateVisible = useCookie<boolean>("nana-live-summary-regenerate", {
  default: () => true,
  maxAge: 60 * 60 * 24 * 365,
  sameSite: "lax",
});

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

const canRegenerate = computed(
  () => !props.active && !pending.value && props.summary.status === "ok",
);

const showRegenerateButton = computed(
  () => canRegenerate.value && regenerateVisible.value === true,
);

const showRegenerateToggle = computed(
  () => canRegenerate.value && regenerateVisible.value === false,
);

const showActionButton = computed(
  () => pending.value || canGenerate.value || showRegenerateButton.value,
);

const buttonLabel = computed(() => {
  if (pending.value) {
    return props.summary.status === "ok" ? "重新生成中..." : "正在生成...";
  }
  if (props.summary.status === "ok") {
    return "重新生成";
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

async function generate(regenerate = false) {
  if (props.active || pending.value) {
    return;
  }
  if (regenerate ? !canRegenerate.value : !canGenerate.value) {
    return;
  }
  pending.value = true;
  errorMessage.value = null;
  try {
    const response = await $fetch<DanmuLiveSummaryResponse>(
      `/api/danmu/${props.sessionId}/summary${regenerate ? "?regenerate=1" : ""}`,
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

function hideRegenerate() {
  regenerateVisible.value = false;
}

function showRegenerate() {
  regenerateVisible.value = true;
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
      <div v-if="showActionButton" class="flex shrink-0 items-center gap-1">
        <button
          class="h-8 text-[13px]"
          :class="summary.status === 'ok' ? 'btn-ghost' : 'btn-primary'"
          type="button"
          :disabled="pending"
          @click="generate(summary.status === 'ok')"
        >
          <span
            v-if="pending"
            class="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px]"
            :class="
              summary.status === 'ok'
                ? 'border-ink/20 border-t-ink'
                : 'border-white/30 border-t-white'
            "
          />
          {{ buttonLabel }}
        </button>
        <button
          v-if="showRegenerateButton"
          class="btn-ghost h-8 px-2 text-[12px]"
          type="button"
          title="隐藏重新生成按钮"
          @click="hideRegenerate"
        >
          隐藏
        </button>
      </div>
      <button
        v-else-if="showRegenerateToggle"
        class="btn-icon"
        type="button"
        title="显示重新生成"
        @click="showRegenerate"
      >
        <AppIcon name="more" />
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
