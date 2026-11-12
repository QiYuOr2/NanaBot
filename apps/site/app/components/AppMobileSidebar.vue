<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue";

const open = useMobileSidebar();
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const route = useRoute();
const close = () => {
  open.value = false;
};
let desktop: MediaQueryList | undefined;
let stopWatching: (() => void) | undefined;
function onResize() {
  if (desktop?.matches) close();
}
function onDialogClose() {
  if (!dialog.value?.open) close();
}
watch(() => route.fullPath, close);

onMounted(() => {
  desktop = window.matchMedia("(min-width: 1024px)");
  desktop.addEventListener("change", onResize);
  stopWatching = watch(
    open,
    (visible, _, onCleanup) => {
      if (desktop?.matches) {
        close();
        return;
      }
      if (!visible || !dialog.value) return;
      const element = dialog.value;
      const previousOverflow = document.documentElement.style.overflow;
      element.showModal();
      document.documentElement.style.overflow = "hidden";
      onCleanup(() => {
        element.close();
        document.documentElement.style.overflow = previousOverflow;
      });
    },
    { immediate: true, flush: "post" },
  );
});
onBeforeUnmount(() => {
  stopWatching?.();
  desktop?.removeEventListener("change", onResize);
  close();
});
</script>

<template>
  <dialog
    id="mobile-sidebar"
    ref="dialog"
    aria-label="页面导航"
    class="sidebar-drawer fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(300px,calc(100vw-40px))] max-w-none border-0 bg-surface p-0 pb-[env(safe-area-inset-bottom)] text-ink shadow-xl backdrop:bg-ink/40"
    @cancel.prevent="close"
    @close="onDialogClose"
    @click.self="close"
  >
    <AppSidebar mobile @navigate="close" @close="close" />
  </dialog>
</template>

<style scoped>
@media (prefers-reduced-motion: no-preference) {
  .sidebar-drawer[open] {
    animation: sidebar-enter 180ms ease-out;
  }
}
@keyframes sidebar-enter {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(0);
  }
}
</style>
