<script setup lang="ts">
import { computed, ref } from "vue";
import type { QQGroupsResponse } from "#shared/qq-groups";

useHead({ title: "群配置 · NanaBot" });
const requestFetch = useRequestFetch();
const loading = ref(false);
const error = ref("");
const settings = ref<QQGroupsResponse | null>(null);
const missing = computed(
  () =>
    settings.value?.accounts.reduce(
      (total, account) => total + account.groups.filter((group) => !group.openid).length,
      0,
    ) ?? 0,
);

function messageOf(cause: unknown): string {
  const failure = cause as { data?: { statusMessage?: string }; message?: string };
  return failure.data?.statusMessage ?? failure.message ?? "加载失败，请稍后重试";
}
async function load() {
  loading.value = true;
  error.value = "";
  try {
    settings.value = await requestFetch<QQGroupsResponse>("/api/settings/qq-groups");
  } catch (cause) {
    error.value = messageOf(cause);
  } finally {
    loading.value = false;
  }
}
await load();
</script>

<template>
  <AppHeader :trail="[{ label: 'NanaBot', to: '/' }, { label: '设置' }]">
    <AppRefreshButton :pending="loading" @click="load" />
  </AppHeader>
  <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
    <h1 class="text-[22px] font-semibold tracking-tight">QQ 群映射</h1>
    <p class="mt-2 text-[13px] leading-relaxed text-ink-secondary">
      为每个机器人绑定对应的通知群，保存后下次推送自动使用新配置。
    </p>

    <p v-if="error && !settings" role="alert" class="card mt-5 p-5 text-sm text-status-red">
      {{ error }}
    </p>

    <template v-if="settings">
      <div class="card mt-5 p-4">
        <div class="flex flex-wrap items-center gap-2 text-[13px]">
          <span class="font-medium">{{ settings.accounts.length }} 个官方机器人</span>
          <span v-if="settings.napcatAccounts.length" class="text-ink-secondary"
            >· {{ settings.napcatAccounts.length }} 个 NapCat 账号</span
          >
          <span class="text-ink-muted">·</span>
          <span :class="missing ? 'text-status-orange' : 'text-live'">{{
            missing ? `${missing} 个群待绑定` : "全部群已绑定"
          }}</span>
        </div>
        <p class="mt-2 text-[13px] leading-relaxed text-ink-secondary">
          在要绑定的 QQ 群里
          @对应机器人发一条消息，然后点击右上角刷新，在该群的候选列表中选择刚发现的标识并保存。无需停止
          bot。
        </p>
        <p v-if="settings.provider === 'mixed'" class="mt-2 text-[12px] text-ink-secondary">
          两种通道同时运行。下方仅为官方机器人绑定群标识，NapCat 账号直接使用 QQ 群号。
        </p>
        <p v-else-if="settings.provider === 'napcat'" class="mt-2 text-[12px] text-ink-secondary">
          当前账号均使用 NapCat，无需配置 group_openid。
        </p>
      </div>
      <p v-if="error" role="alert" class="mt-4 text-[13px] text-status-red">{{ error }}</p>
      <section
        v-if="!settings.accounts.length"
        class="card mt-4 p-5 text-[13px] leading-relaxed text-ink-secondary"
      >
        当前没有启用官方机器人。可在 nana.config.yaml 的 accounts 中添加 provider: official
        的账号，并设置 AppID 与 AppSecret；群映射可以随后在这里填写。
      </section>
      <section v-if="settings.napcatAccounts.length" class="card mt-6 p-5">
        <h2 class="text-[14px] font-medium">NapCat 账号</h2>
        <p class="mt-2 text-[13px] text-ink-secondary">
          这些账号通过 NapCat 连接，通知群使用 QQ 群号。
        </p>
        <ul class="mt-3 space-y-2">
          <li
            v-for="account in settings.napcatAccounts"
            :key="account.id"
            class="flex flex-wrap items-center gap-2 text-[13px]"
          >
            <span>{{ account.name }}</span>
            <span class="font-mono text-[12px] text-ink-muted">{{ account.id }}</span>
            <span class="ml-auto rounded bg-recessed px-2 py-0.5 text-[11px] text-ink-secondary"
              >NapCat</span
            >
          </li>
        </ul>
      </section>
      <section v-for="account in settings.accounts" :key="account.id" class="mt-6">
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <h2 class="text-[15px] font-semibold">{{ account.name }}</h2>
          <span class="rounded bg-recessed px-2 py-0.5 font-mono text-[11px] text-ink-muted">{{
            account.id
          }}</span>
          <span class="ml-auto text-[12px] text-ink-muted"
            >已发现 {{ account.discovered.length }} 个群</span
          >
        </div>
        <div class="space-y-3">
          <QQGroupMappingRow
            v-for="group in account.groups"
            :key="group.id"
            :group="group"
            :account-id="account.id"
            :discovered="account.discovered"
            @saved="Object.assign(group, $event)"
          />
          <p v-if="!account.groups.length" class="card p-4 text-[13px] text-ink-muted">
            这个账号还没有通知群。请先为主播配置通知群、词云群或账号管理群。
          </p>
        </div>
      </section>
    </template>
  </main>
</template>
