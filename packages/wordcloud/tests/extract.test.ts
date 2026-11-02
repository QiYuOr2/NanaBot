import { describe, expect, test } from "vite-plus/test";
import {
  DEFAULT_NOISE_WORDS,
  DEFAULT_STOP_WORDS,
  FINANCE_DICT_WORDS,
  INTERNET_DICT_WORDS,
  LIVESTREAM_DICT_WORDS,
  MODERN_DICT_WORDS,
  extractWords,
} from "../src/index.ts";

describe("extractWords", () => {
  test("统计高频词并按出现次数降序排列", () => {
    // "原神" 出现 3 次，是唯一的第一名；其余词条频次相同时按词升序，保证结果确定。
    const words = extractWords(["原神好玩", "原神真好玩", "原神剧情太棒了", "剧情很感人"]);

    expect(words.length).toBeGreaterThan(0);
    expect(words[0]).toEqual({ word: "原神", count: 3 });
    expect(words[0]?.count).toBeGreaterThan(words[1]?.count ?? 0);
    // 排序稳定：count 相同则按词升序，因此相邻元素必然有序。
    for (let index = 1; index < words.length; index += 1) {
      const previous = words[index - 1];
      const current = words[index];
      if (!previous || !current) {
        continue;
      }
      expect(previous.count).toBeGreaterThanOrEqual(current.count);
      if (previous.count === current.count) {
        expect(previous.word <= current.word).toBe(true);
      }
    }
  });

  test("默认停用词与噪音词被过滤", () => {
    const words = extractWords(["哈哈哈 这个 主播 好好笑", "666 关注 一下"]);
    const collected = words.map((item) => item.word);

    expect(collected).not.toContain("这个");
    expect(collected).not.toContain("主播");
    expect(collected).not.toContain("666");
    expect(collected).not.toContain("关注");
    // “哈哈哈” 属于噪音词，分词后即便被拆成 “哈哈” 也会被过滤。
    expect(collected).not.toContain("哈哈");
  });

  test("单字、纯数字、纯标点与纯 emoji 被丢弃", () => {
    const words = extractWords(["我 你 他 123 8888 ！！！ 。。。 😂😂🎉 原神的剧情很棒"]);

    expect(words.map((item) => item.word)).toEqual(expect.arrayContaining(["原神", "剧情"]));
    for (const item of words) {
      expect(item.word).not.toBe("我");
      expect(item.word).not.toMatch(/^\d+$/);
      expect(item.word).not.toMatch(/^[\p{P}\p{S}]+$/u);
      expect(Array.from(item.word).length).toBeGreaterThanOrEqual(2);
    }
  });

  test("minLength 可以调大，但不能降到 1", () => {
    const longOnly = extractWords(["原神的剧情很好看"], { minLength: 3 });

    expect(longOnly.every((item) => Array.from(item.word).length >= 3)).toBe(true);
    expect(extractWords(["剧情"], { minLength: 1 })[0]?.word).toBe("剧情");
  });

  test("topN 截断返回条数", () => {
    const words = extractWords(["原神 剧情 深渊 角色 活动 版本"], { topN: 20 });

    expect(extractWords(["原神 剧情 深渊 角色 活动 版本"], { topN: 2 })).toHaveLength(2);
    expect(words.length).toBeGreaterThanOrEqual(2);
  });

  test("extraStopWords / extraNoiseWords 在默认词表之上追加", () => {
    const contents = ["娜娜今天好可爱", "关注娜娜不迷路"];

    const filtered = extractWords(contents, { extraStopWords: ["娜娜"] });

    expect(filtered.map((item) => item.word)).not.toContain("娜娜");
    expect(filtered.map((item) => item.word)).toContain("可爱");
    // extraNoiseWords 同样叠加在默认噪音词之上，而不是替换默认表。
    const noiseFiltered = extractWords(["哈哈 原神"], { extraNoiseWords: ["原神"] });
    expect(noiseFiltered.map((item) => item.word)).not.toContain("原神");
    expect(noiseFiltered.map((item) => item.word)).not.toContain("哈哈");
  });

  test("同一行里同一个词只计一次", () => {
    const words = extractWords(["原神 原神 原神", "剧情"]);
    const map = new Map(words.map((item) => [item.word, item.count]));

    // 一行内重复出现不算多次；不同行各计一次，因此 “原神” 记 1 次。
    expect(map.get("原神")).toBe(1);
    expect(map.get("剧情")).toBe(1);
    // 同样的词分别出现在两行时计 2 次。
    expect(new Map(extractWords(["原神", "原神"]).map((i) => [i.word, i.count])).get("原神")).toBe(
      2,
    );
  });

  test("排序规则：count 降序，count 相同时按 word 升序", () => {
    // “丙丙”/“丁丁” 各出现 1 次且都不是停用词，最终顺序必须是纯按词条升序。
    const words = extractWords(["丙丙", "丁丁", "原神", "原神"], { stopWords: [], noiseWords: [] });
    const counts = words.map((item) => item.count);

    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    const tied = words.filter((item) => item.count === 1).map((item) => item.word);
    expect(tied).toEqual([...tied].sort());
  });

  test("topN 截断返回条数", () => {
    const all = extractWords(["原神 剧情 深渊 角色 活动 版本"], { topN: 20 });

    expect(extractWords(["原神 剧情 深渊 角色 活动 版本"], { topN: 2 })).toHaveLength(2);
    expect(all.length).toBeGreaterThanOrEqual(2);
    // topN 只是截断，前缀必须与全量结果一致。
    expect(extractWords(["原神 剧情 深渊 角色 活动 版本"], { topN: 2 })).toEqual(all.slice(0, 2));
  });

  test("传入 stopWords 时整体替换默认停用词", () => {
    // 默认停用词 “这个” 在不传 stopWords 时会被丢弃；传空数组后会被保留。
    expect(extractWords(["这个场景"]).map((item) => item.word)).not.toContain("这个");
    expect(extractWords(["这个场景"], { stopWords: [] }).map((item) => item.word)).toContain(
      "这个",
    );
  });

  test("同一输入多次调用结果一致", () => {
    const contents = ["原神好玩", "剧情很棒", "角色好看"];

    expect(extractWords(contents)).toEqual(extractWords(contents));
  });

  test("空输入返回空数组", () => {
    expect(extractWords([])).toEqual([]);
    expect(extractWords(["", "   "])).toEqual([]);
  });

  test("内置词表非空且没有重复项", () => {
    expect(DEFAULT_STOP_WORDS.length).toBeGreaterThan(100);
    expect(DEFAULT_NOISE_WORDS.length).toBeGreaterThan(40);
    expect(new Set(DEFAULT_STOP_WORDS).size).toBe(DEFAULT_STOP_WORDS.length);
    expect(new Set(DEFAULT_NOISE_WORDS).size).toBe(DEFAULT_NOISE_WORDS.length);
    expect(INTERNET_DICT_WORDS.length).toBeGreaterThan(40);
    expect(LIVESTREAM_DICT_WORDS.length).toBeGreaterThan(40);
    expect(FINANCE_DICT_WORDS.length).toBeGreaterThan(40);
    expect(new Set(MODERN_DICT_WORDS).size).toBe(MODERN_DICT_WORDS.length);
  });

  test("方括号表情包不进词云", () => {
    const words = extractWords(["好看[dog][笑哭]【妙】", "[dog]", "［DOG］真好看"]);
    const collected = words.map((item) => item.word);

    expect(collected).toContain("好看");
    expect(collected).not.toContain("dog");
    expect(collected).not.toContain("笑");
    expect(collected).not.toContain("哭");
    expect(collected).not.toContain("笑哭");
    expect(collected).not.toContain("妙");
  });

  test("网络新词和直播用语按整词统计", () => {
    const words = extractWords([
      "家人们谁懂啊绝绝子",
      "显眼包班味好重",
      "二次元三次元",
      "蚌埠住了",
    ]);
    const collected = words.map((item) => item.word);

    expect(collected).toEqual(
      expect.arrayContaining([
        "家人们",
        "谁懂",
        "绝绝子",
        "显眼包",
        "班味",
        "二次元",
        "三次元",
        "蚌埠住了",
      ]),
    );
    expect(collected).not.toContain("绝子");
    expect(collected).not.toContain("包班味");
  });

  test("久留美、本年番剧和网络新词按整词统计", () => {
    const words = extractWords([
      "韭留美爆仓了",
      "久留美萌智子山师芽吹",
      "不烧心功夫小猫",
      "我是浙江人",
      "别杀我我是浙江人",
      "葬送的芙莉莲",
      "在超市后门吸烟的二人",
      "正相反的你与我",
      "星野爱久爱海",
    ]);
    const collected = words.map((item) => item.word);

    expect(collected).toEqual(
      expect.arrayContaining([
        "韭留美",
        "爆仓",
        "久留美",
        "萌智子",
        "山师芽吹",
        "不烧心",
        "功夫小猫",
        "我是浙江人",
        "别杀我我是浙江人",
        "葬送的芙莉莲",
        "在超市后门吸烟的二人",
        "正相反的你与我",
        "星野爱久爱海",
      ]),
    );
    expect(collected).not.toContain("留美");
    expect(collected).not.toContain("烧心");
    expect(collected).not.toContain("芙莉");
    expect(collected).not.toContain("浙江人");
  });

  test("金融用语按整词统计", () => {
    const words = extractWords(["北向资金抄底涨停板", "换手率市盈率", "可转债国债逆回购"]);
    const collected = words.map((item) => item.word);

    expect(collected).toEqual(
      expect.arrayContaining([
        "北向资金",
        "抄底",
        "涨停板",
        "换手率",
        "市盈率",
        "可转债",
        "国债逆回购",
      ]),
    );
    expect(collected).not.toContain("涨停");
    expect(collected).not.toContain("逆回");
  });

  test("口语虚词不进词云，没有对象的利好 / 切碎的之刃也不单独成词", () => {
    const fillers = extractWords(["没有真是出来后面直接再见"]);
    expect(fillers.map((item) => item.word)).toEqual([]);

    const bare = extractWords(["利好就是利空", "之刃"]);
    const bareWords = bare.map((item) => item.word);
    expect(bareWords).not.toContain("利好");
    expect(bareWords).not.toContain("利空");
    expect(bareWords).not.toContain("之刃");

    const phrases = extractWords([
      "利好机器人",
      "利好商业航天",
      "利好紫金矿业",
      "利好巅峰之智",
      "下周播影之刃吧",
      "影之刃零启动",
      "股神来了",
      "牛来",
      "饭总说抄底",
    ]);
    const collected = phrases.map((item) => item.word);

    expect(collected).toEqual(
      expect.arrayContaining([
        "利好机器人",
        "利好商业航天",
        "利好紫金矿业",
        "利好巅峰之智",
        "影之刃",
        "影之刃零",
        "股神",
        "牛来",
        "抄底",
      ]),
    );
    expect(collected).not.toContain("利好");
    expect(collected).not.toContain("之刃");
    expect(collected).not.toContain("之智");
    expect(collected).not.toContain("股神来");
    expect(collected).not.toContain("饭");
  });
});
