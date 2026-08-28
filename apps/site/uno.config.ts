import { defineConfig, presetWind3 } from "unocss";
import { presetVercel } from "./presets/vercel.ts";

export default defineConfig({
  presets: [presetWind3(), presetVercel()],
});
