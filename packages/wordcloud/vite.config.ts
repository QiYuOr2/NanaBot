import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: {
      tsgo: true,
    },
    exports: true,
    // jieba / resvg 都带原生 .node 绑定，必须保持 external 由 Node 直接加载，不能打进 bundle。
    deps: {
      neverBundle: ["@node-rs/jieba", "@resvg/resvg-js"],
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
