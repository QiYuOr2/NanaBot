<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { QQGroupSetting, QQAccountSetting } from "#shared/qq-groups";

const props = defineProps<{
  accountId: string;
  group: QQGroupSetting;
  discovered: QQAccountSetting["discovered"];
  token: string;
}>();
const emit = defineEmits<{ saved: [value: { name: string; openid: string }] }>();
const name = ref(props.group.name);
const openid = ref(props.group.openid ?? "");
const savedName = ref(props.group.name);
const savedOpenid = ref(props.group.openid);
const saving = ref(false);
const error = ref("");
const success = ref(false);
const conflicted = ref(false);
const dirty = computed(
  () => name.value.trim() !== savedName.value || openid.value.trim() !== (savedOpenid.value ?? ""),
);
const prefix = computed(() => `qq-${props.accountId}-${props.group.id}`);
watch(
  () => [props.group.openid, props.group.name] as const,
  ([nextOpenid, nextName]) => {
    if (dirty.value && !conflicted.value) return;
    openid.value = nextOpenid ?? "";
    name.value = nextName;
    savedOpenid.value = nextOpenid;
    savedName.value = nextName;
    conflicted.value = false;
    error.value = "";
  },
);
watch([name, openid], () => {
  success.value = false;
  error.value = "";
});

function seenLabel(timestamp: string): string {
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}
function selectDiscovered(event: Event) {
  openid.value = (event.target as HTMLSelectElement).value;
}
async function save() {
  if (!openid.value.trim() || saving.value) return;
  saving.value = true;
  success.value = false;
  error.value = "";
  try {
    await $fetch("/api/settings/qq-groups", {
      method: "PUT",
      headers: { Authorization: `Bearer ${props.token}` },
      body: {
        accountId: props.accountId,
        groupId: props.group.id,
        name: name.value.trim(),
        openid: openid.value.trim(),
        expectedOpenid: savedOpenid.value,
      },
    });
    savedName.value = name.value.trim();
    savedOpenid.value = openid.value.trim();
    success.value = true;
    emit("saved", { name: savedName.value, openid: savedOpenid.value });
  } catch (cause) {
    const failure = cause as {
      statusCode?: number;
      data?: { statusCode?: number; statusMessage?: string };
    };
    conflicted.value = (failure.statusCode ?? failure.data?.statusCode) === 409;
    error.value = failure.data?.statusMessage ?? "保存失败，请稍后重试";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="card p-4 sm:p-5" @submit.prevent="save">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="text-[14px] font-medium">{{ group.name || `群 ${group.id}` }}</h3>
      <span class="font-mono text-[12px] text-ink-muted">{{ group.id }}</span>
      <span
        class="ml-auto rounded px-2 py-0.5 text-[11px]"
        :class="savedOpenid ? 'bg-live/10 text-live' : 'bg-status-orange/10 text-status-orange'"
        >{{ savedOpenid ? "已绑定" : "待绑定" }}</span
      >
    </div>
    <p class="mt-1 text-[12px] text-ink-muted">{{ group.uses.join("、") || "已有群映射" }}</p>
    <div class="mt-4 grid gap-4 sm:grid-cols-[180px_1fr]">
      <div>
        <label :for="`${prefix}-name`" class="text-[12px] text-ink-secondary">群名称</label>
        <input
          :id="`${prefix}-name`"
          v-model="name"
          class="input mt-1.5 w-full"
          maxlength="100"
          placeholder="便于识别的群名称"
          :disabled="saving"
        />
      </div>
      <div class="min-w-0">
        <label :for="`${prefix}-candidate`" class="text-[12px] text-ink-secondary"
          >从已发现的群中选择</label
        >
        <select
          :id="`${prefix}-candidate`"
          class="input mt-1.5 w-full"
          :value="discovered.some((item) => item.openid === openid) ? openid : ''"
          :disabled="saving || !discovered.length"
          @change="selectDiscovered"
        >
          <option disabled value="">
            {{
              discovered.length
                ? "选择刚在 QQ 中发消息的群（按最近发现排序）"
                : "暂无候选，请在对应群 @机器人后刷新"
            }}
          </option>
          <option v-for="candidate in discovered" :key="candidate.openid" :value="candidate.openid">
            {{ seenLabel(candidate.lastSeenAt) }} · {{ candidate.openid }}
          </option>
        </select>
      </div>
    </div>
    <div class="mt-4">
      <label :for="`${prefix}-openid`" class="text-[12px] text-ink-secondary">group_openid</label>
      <input
        :id="`${prefix}-openid`"
        v-model="openid"
        class="input mt-1.5 w-full font-mono"
        maxlength="256"
        required
        autocomplete="off"
        spellcheck="false"
        placeholder="可从候选列表选择，也可手动粘贴"
        :disabled="saving"
      />
    </div>
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <button type="submit" class="btn-primary" :disabled="saving || !dirty || !openid.trim()">
        {{ saving ? "正在保存…" : "保存映射" }}
      </button>
      <span v-if="success" role="status" class="text-[12px] text-live">已保存，下次推送生效</span>
      <span v-else-if="dirty" class="text-[12px] text-ink-muted">有未保存的修改</span>
      <span v-if="error" role="alert" class="text-[12px] text-status-red">{{ error }}</span>
    </div>
  </form>
</template>
