<template>
  <div class="flex min-h-screen bg-canvas font-sans text-ink antialiased">
    <AppSidebar />

    <div class="flex min-w-0 flex-1 flex-col">
      <slot />
    </div>
  </div>
</template>
