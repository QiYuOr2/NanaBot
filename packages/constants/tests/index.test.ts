import { expect, test } from "vite-plus/test";
import {
  BARK_BASE_URL,
  BARK_ICON_URL,
  APP_STATE_FILE,
  DANMU_FILE,
  DATABASE_DIRECTORY,
  DEFAULT_NC_WS_URL,
  ENV_KEYS,
  LIVE_STATUS_FILE,
  NANA_CONFIG_FILE,
  PUSH_LOG_PURPOSES,
  PUSH_PURPOSE_LABELS,
} from "../src/index.ts";

test("项目文件与目录常量与目录结构一致", () => {
  expect(NANA_CONFIG_FILE).toBe("nana.config.yaml");
  expect(DATABASE_DIRECTORY).toBe("db");
  expect(LIVE_STATUS_FILE).toBe("live-status.sqlite");
  expect(APP_STATE_FILE).toBe("app-state.sqlite");
  expect(DANMU_FILE).toBe("danmu.sqlite");
});

test("默认网络地址", () => {
  expect(DEFAULT_NC_WS_URL).toBe("ws://127.0.0.1:1111");
});

test("Bark 常量", () => {
  expect(BARK_BASE_URL).toBe("https://api.day.app/");
  expect(BARK_ICON_URL).toBe("https://unavatar.io/github/qiyuor2");
});

test("环境变量名统一", () => {
  expect(ENV_KEYS.ADM_GROUP).toBe("ADM_GROUP");
  expect(ENV_KEYS.BARK_KEY).toBe("BARK_KEY");
  expect(ENV_KEYS.NC_WS_URL).toBe("NC_WS_URL");
  expect(ENV_KEYS.NC_ACCESS_TOKEN).toBe("NC_ACCESS_TOKEN");
  expect(ENV_KEYS.NC_DEBUG).toBe("NC_DEBUG");
  expect(ENV_KEYS.QQ_BOT_APP_ID).toBe("QQ_BOT_APP_ID");
  expect(ENV_KEYS.QQ_BOT_APP_SECRET).toBe("QQ_BOT_APP_SECRET");
  expect(ENV_KEYS.DEEPSEEK_API_KEY).toBe("DEEPSEEK_API_KEY");
});

test("推送目的包含词云，且每个目的都有中文展示名", () => {
  expect(PUSH_LOG_PURPOSES).toContain("wordcloud");
  expect(PUSH_PURPOSE_LABELS.wordcloud).toBe("词云");
  expect(PUSH_LOG_PURPOSES).toContain("live.summary");
  expect(PUSH_PURPOSE_LABELS["live.summary"]).toBe("直播摘要");

  for (const purpose of PUSH_LOG_PURPOSES) {
    expect(PUSH_PURPOSE_LABELS[purpose]).toBeTruthy();
  }
});
