<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 是否正在刷新；为 true 时展示转圈并禁用按钮。 */
    pending?: boolean;
  }>(),
  { pending: false },
);
</script>

<template>
  <button class="btn-primary h-8 text-[13px]" type="button" :disabled="pending">
    <span
      v-if="pending"
      class="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-white/30 border-t-white"
    />
    {{ pending ? "刷新中..." : "刷新" }}
  </button>
</template>
