<script setup lang="ts">
import type { SystemUsage } from "#shared/system";
defineProps<{ label: string; usage: SystemUsage }>();
function bytes(value: number) {
  return value >= 1024 ** 4
    ? `${(value / 1024 ** 4).toFixed(1)} TiB`
    : `${(value / 1024 ** 3).toFixed(1)} GiB`;
}
</script>

<template>
  <section class="card min-w-0 p-5">
    <h2 class="break-all text-[13px] font-medium text-ink-secondary">{{ label }}</h2>
    <p class="mt-3 font-mono text-[28px] tracking-tight">
      {{ usage.percent }}<span class="ml-1 text-[15px] text-ink-muted">%</span>
    </p>
    <div
      class="mt-3 h-1.5 overflow-hidden rounded-full bg-line"
      role="progressbar"
      :aria-label="label"
      :aria-valuenow="usage.percent"
      :aria-valuemin="0"
      :aria-valuemax="100"
    >
      <div
        class="h-full rounded-full"
        :class="usage.percent >= 90 ? 'bg-status-red' : 'bg-accent-bright'"
        :style="{ width: `${Math.min(100, Math.max(0, usage.percent))}%` }"
      />
    </div>
    <p class="mt-3 text-[12px] text-ink-muted">
      已用 {{ bytes(usage.used) }} / {{ bytes(usage.total) }}
    </p>
    <p class="mt-1 text-[12px] text-ink-muted">可用 {{ bytes(usage.available) }}</p>
  </section>
</template>
