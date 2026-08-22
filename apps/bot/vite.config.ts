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
