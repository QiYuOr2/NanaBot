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
    <AppIcon
      name="sync"
      :size="18"
      variant="color"
      class="text-white"
      :class="pending ? 'animate-spin' : ''"
    />
    {{ pending ? "刷新中..." : "刷新" }}
  </button>
</template>
