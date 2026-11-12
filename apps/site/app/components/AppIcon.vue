<script setup lang="ts">
import {
  Activity,
  Bell,
  ChevronDown,
  CircleX,
  Clock,
  Cloud,
  Filter,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Monitor,
  MoreHorizontal,
  Search,
  Send,
  Settings,
  Sparkles,
  Sync,
} from "kubai-icons-vue";
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    name: string;
    size?: number | string;
    variant?: "color" | "soft";
  }>(),
  {
    size: 22,
    variant: "soft",
  },
);

const iconMap = {
  activity: Activity,
  bell: Bell,
  "chevron-down": ChevronDown,
  clock: Clock,
  close: CircleX,
  cloud: Cloud,
  dashboard: LayoutDashboard,
  filter: Filter,
  grid: LayoutDashboard,
  menu: Menu,
  "message-square": MessageSquare,
  monitor: Monitor,
  more: MoreHorizontal,
  search: Search,
  send: Send,
  settings: Settings,
  sparkles: Sparkles,
  sync: Sync,
  x: CircleX,
} as const;

const icon = computed(() => iconMap[props.name as keyof typeof iconMap] ?? LayoutDashboard);
</script>

<template>
  <component :is="icon" :size="size" :variant="variant" trigger="parent" />
</template>
