export default defineNuxtConfig({
  compatibilityDate: "2026-08-01",
  devtools: { enabled: true },
  modules: ["@unocss/nuxt"],
  css: [
    "@unocss/reset/tailwind.css",
    "@fontsource/geist-sans/400.css",
    "@fontsource/geist-sans/500.css",
    "@fontsource/geist-sans/600.css",
    "@fontsource/geist-mono/400.css",
    "@fontsource/geist-mono/500.css",
  ],
  typescript: {
    strict: true,
  },
  app: {
    head: {
      htmlAttrs: { lang: "zh-CN" },
      title: "NanaBot 直播状态",
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
      ],
    },
  },
});
