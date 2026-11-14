import { expect, test } from "vite-plus/test";
import { groupActivitiesByDay } from "../shared/push-presentation.ts";

function item(latestAt: string) {
  return { latestAt };
}

test("按本地日期分组并保持原顺序，今天/昨天用相对标题", () => {
  const now = new Date(2026, 10, 14, 20, 0, 0); // 2026-11-14（周六）20:00 本地时间
  const groups = groupActivitiesByDay(
    [
      item(new Date(2026, 10, 14, 19, 0).toISOString()),
      item(new Date(2026, 10, 14, 9, 30).toISOString()),
      item(new Date(2026, 10, 13, 23, 10).toISOString()),
      item(new Date(2026, 10, 10, 12, 0).toISOString()),
    ],
    now,
  );

  expect(groups.map((group) => group.label)).toEqual(["今天", "昨天", "11月10日 周二"]);
  expect(groups.map((group) => group.items.length)).toEqual([2, 1, 1]);
  expect(groups[0]?.key).toBe("2026-11-14");
});

test("跨年时昨天仍按日期差识别", () => {
  const now = new Date(2027, 0, 1, 0, 30);
  const groups = groupActivitiesByDay([item(new Date(2026, 11, 31, 23, 0).toISOString())], now);
  expect(groups[0]?.label).toBe("昨天");
});

test("时间非法的活动单独成组，标题回退为原始字符串", () => {
  const groups = groupActivitiesByDay([item("not-a-date"), item("also-bad")]);
  expect(groups).toHaveLength(2);
  expect(groups[0]?.label).toBe("not-a-date");
});

test("空列表返回空分组", () => {
  expect(groupActivitiesByDay([])).toEqual([]);
});
