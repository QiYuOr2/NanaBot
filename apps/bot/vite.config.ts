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
      build: {
        command: "tsc && vp build",
        dependsOn: [{ task: "build", from: "dependencies" }],
      },
    },
  },
});
