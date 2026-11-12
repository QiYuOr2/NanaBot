<template>
  <div class="app-shell flex min-h-screen bg-canvas font-sans text-ink antialiased">
    <div class="sticky top-0 hidden h-dvh w-[260px] shrink-0 lg:block">
      <AppSidebar />
    </div>
    <AppMobileSidebar />

    <div class="flex min-w-0 flex-1 flex-col">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  background:
    radial-gradient(80% 55% at 50% -12%, rgb(232 130 44 / 9%), transparent 70%),
    linear-gradient(180deg, #fbf9f6 0%, #f6f2ed 100%);
}
</style>
