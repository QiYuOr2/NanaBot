import { resolve } from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
  build: {
    target: "node22",
    ssr: "src/index.ts",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "src/index.ts"),
      // 带 .node 原生绑定的包必须保持 external，由 Node 直接 require 加载。
      external: ["@node-rs/jieba", "@node-rs/jieba/dict", "@resvg/resvg-js"],
      output: {
        entryFileNames: "index.mjs",
      },
    },
  },
  run: {
    tasks: {
      // 扫码和发现依赖外部交互，不能缓存终端输出或凭据文件。
      "qq:bind": {
        command: "node scripts/qq-bind.ts",
        cache: false,
        dependsOn: [
          "@nana/constants#build",
          "@nana/utils#build",
          "@nana/config#build",
          "@nana/qq#build",
        ],
      },
      "qq:discover": {
        command: "node scripts/qq-discover.ts",
        cache: false,
        dependsOn: [
          "@nana/constants#build",
          "@nana/utils#build",
          "@nana/config#build",
          "@nana/qq#build",
        ],
      },
      build: {
        command: "tsc && vp build",
        dependsOn: [{ task: "build", from: "dependencies" }],
      },
    },
  },
});
