<script setup lang="ts">
import type { SystemStatusResponse } from "#shared/system";
useHead({ title: "服务器状态 · NanaBot" });
const { data, error, pending, refresh } = await useFetch<SystemStatusResponse>("/api/system");
function duration(seconds: number) {
  return `${Math.floor(seconds / 86400)} 天 ${Math.floor((seconds % 86400) / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分钟`;
}
</script>

<template>
  <AppHeader :trail="[{ label: 'NanaBot', to: '/' }, { label: '服务器状态' }]">
    <AppRefreshButton :pending="pending" @click="refresh" />
  </AppHeader>
  <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
    <h1 class="text-[22px] font-semibold tracking-tight">服务器状态</h1>
    <p class="mt-2 text-[13px] text-ink-secondary">
      进入页面或手动刷新时采集一次，展示 site 所在服务器的系统状态。
    </p>
    <p v-if="error" role="alert" class="card mt-5 p-5 text-sm text-status-red">
      状态加载失败：{{ error.message }}
    </p>
    <template v-else-if="data">
      <section class="card mt-5 flex flex-wrap justify-between gap-4 p-5 text-[13px]">
        <div>
          <p class="font-medium">{{ data.hostname }}</p>
          <p class="mt-1 text-ink-muted">{{ data.platform }} · {{ data.arch }}</p>
        </div>
        <div class="text-ink-muted">
          <p>运行 {{ duration(data.uptime) }}</p>
          <p class="mt-1">
            采集于 {{ new Date(data.generatedAt).toLocaleString("zh-CN", { hour12: false }) }}
          </p>
        </div>
      </section>
      <div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <section class="card p-5">
          <h2 class="text-[13px] font-medium text-ink-secondary">CPU · {{ data.cpu.cores }} 核</h2>
          <p class="mt-3 font-mono text-[28px]">
            {{ data.cpu.percent }}<span class="ml-1 text-[15px] text-ink-muted">%</span>
          </p>
          <p class="mt-3 text-[12px] text-ink-muted">{{ data.cpu.model }}</p>
          <p class="mt-2 text-[12px] text-ink-muted">
            1 / 5 / 15 分钟负载：{{ data.cpu.load.map((value) => value.toFixed(2)).join(" / ") }}
          </p>
        </section>
        <SystemUsageCard label="内存" :usage="data.memory" />
        <SystemUsageCard
          v-if="data.swap && data.swap.total > 0"
          label="交换空间"
          :usage="data.swap"
        />
      </div>
      <h2 class="mb-3 mt-7 text-[15px] font-semibold">磁盘</h2>
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <template v-for="disk in data.disks" :key="disk.mount">
          <SystemUsageCard v-if="disk.usage" :label="disk.mount" :usage="disk.usage" />
          <section v-else class="card p-5 text-[13px] text-status-orange">
            {{ disk.mount }} · {{ disk.error }}
          </section>
        </template>
      </div>
      <h2 class="mb-3 mt-7 text-[15px] font-semibold">GPU</h2>
      <p v-if="data.gpuMessage" class="card p-5 text-[13px] text-ink-muted">
        {{ data.gpuMessage }}
      </p>
      <div v-else class="grid gap-4 sm:grid-cols-2">
        <section v-for="gpu in data.gpus" :key="gpu.index" class="card p-5">
          <h3 class="text-[14px] font-medium">{{ gpu.index }} · {{ gpu.name }}</h3>
          <p class="mt-3 text-[13px] text-ink-secondary">
            使用率 {{ gpu.percent === null ? "不可用" : `${gpu.percent}%` }} · 温度
            {{ gpu.temperature === null ? "不可用" : `${gpu.temperature}°C` }}
          </p>
          <SystemUsageCard v-if="gpu.memory" class="mt-4" label="显存" :usage="gpu.memory" />
          <p v-else class="mt-3 text-[12px] text-ink-muted">显存信息不可用</p>
        </section>
      </div>
    </template>
  </main>
</template>
