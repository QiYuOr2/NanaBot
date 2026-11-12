<template>
  <div class="flex min-h-screen bg-canvas font-sans text-ink antialiased">
    <div class="sticky top-0 hidden h-dvh w-[260px] shrink-0 lg:block">
      <AppSidebar />
    </div>
    <AppMobileSidebar />

    <div class="flex min-w-0 flex-1 flex-col">
      <slot />
    </div>
  </div>
</template>
