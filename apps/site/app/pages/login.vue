<script setup lang="ts">
import { ref } from "vue";

definePageMeta({ layout: false });
useHead({ title: "登录 · NanaBot" });
const route = useRoute();
const { data: session, error: statusError } = await useFetch("/api/auth/session");
const token = ref("");
const pending = ref(false);
const error = ref("");

async function login() {
  if (pending.value) return;
  pending.value = true;
  error.value = "";
  try {
    await $fetch("/api/auth/login", { method: "POST", body: { token: token.value }, retry: 0 });
    token.value = "";
    clearNuxtData();
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/";
    await navigateTo(
      redirect.startsWith("/") &&
        !redirect.startsWith("//") &&
        !redirect.includes("\\") &&
        !redirect.startsWith("/login")
        ? redirect
        : "/",
    );
  } catch (cause) {
    error.value =
      (cause as { data?: { statusMessage?: string } }).data?.statusMessage ??
      "登录失败，请稍后重试";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center bg-canvas px-4 font-sans text-ink">
    <section class="card w-full max-w-sm p-7">
      <span
        class="flex size-10 items-center justify-center rounded-xl bg-accent-bright font-semibold text-white"
        >N</span
      >
      <h1 class="mt-5 text-[22px] font-semibold tracking-tight">登录 NanaBot</h1>
      <p class="mt-2 text-[13px] leading-relaxed text-ink-secondary">
        登录后查看直播、推送、项目日志和服务器状态。
      </p>
      <p v-if="statusError" role="alert" class="mt-5 text-sm text-status-red">
        无法读取登录状态，请刷新重试。
      </p>
      <p
        v-else-if="!session?.configured"
        role="alert"
        class="mt-5 text-[13px] leading-relaxed text-status-orange"
      >
        请先在项目根目录 .env 设置至少 16 位的 NANA_AUTH_TOKEN，然后刷新页面。
      </p>
      <form v-else class="mt-6 space-y-4" @submit.prevent="login">
        <div>
          <label for="password" class="text-[13px] font-medium">项目管理口令</label>
          <input
            id="password"
            v-model="token"
            class="input mt-2 w-full"
            type="password"
            autocomplete="current-password"
            required
            :disabled="pending"
          />
        </div>
        <p class="text-[12px] leading-relaxed text-ink-muted">
          此浏览器记住登录 30 天，可随时退出。
        </p>
        <p v-if="error" role="alert" class="text-[13px] text-status-red">{{ error }}</p>
        <button class="btn-primary w-full" type="submit" :disabled="pending || !token">
          {{ pending ? "正在登录…" : "登录" }}
        </button>
      </form>
    </section>
  </main>
</template>
