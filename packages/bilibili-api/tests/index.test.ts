import { expect, test } from "vite-plus/test";
import { BilibiliApiError, live } from "../src/index.ts";

const liveStatus = {
  title: "正在直播",
  room_id: 123,
  uid: 456,
  online: 789,
  live_time: 1_700_000_000,
  live_status: 1,
  short_id: 0,
  area: 1,
  area_name: "示例分区",
  area_v2_id: 2,
  area_v2_name: "示例新版分区",
  area_v2_parent_id: 3,
  area_v2_parent_name: "示例父分区",
  uname: "示例主播",
  face: "https://example.com/face.jpg",
  tag_name: "",
  tags: "",
  cover_from_user: "",
  keyframe: "",
  lock_till: "",
  hidden_till: "",
  broadcast_type: 0,
};

test("按 UID 查询直播状态并构造重复的 uids[] 参数", async () => {
  let requestedUrl = "";
  let requestedMethod = "";
  const options = {
    baseUrl: "https://example.com",
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requestedMethod = init?.method ?? "";
      return new Response(
        JSON.stringify({ code: 0, message: "success", data: { "456": liveStatus } }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    },
  };

  await expect(live.getLiveStatusByUids([456, 789], options)).resolves.toEqual({
    "456": liveStatus,
  });
  expect(requestedMethod).toBe("GET");
  expect(requestedUrl).toBe(
    "https://example.com/room/v1/Room/get_status_info_by_uids?uids%5B%5D=456&uids%5B%5D=789",
  );
});

test("拒绝空 UID 列表和无效 UID", async () => {
  const options = { fetch: async () => new Response() };

  await expect(live.getLiveStatusByUids([], options)).rejects.toThrow("uids 不能为空");
  await expect(live.getLiveStatusByUids([0], options)).rejects.toThrow("uid 必须是正整数");
});

test("将 HTTP 错误和 B 站业务错误转换为 BilibiliApiError", async () => {
  const httpErrorOptions = {
    fetch: async () => new Response(null, { status: 503 }),
  };
  await expect(live.getLiveStatusByUids([456], httpErrorOptions)).rejects.toBeInstanceOf(
    BilibiliApiError,
  );

  const apiErrorOptions = {
    fetch: async () =>
      new Response(JSON.stringify({ code: -111, message: "csrf校验失败", data: {} }), {
        headers: { "content-type": "application/json" },
      }),
  };
  await expect(live.getLiveStatusByUids([456], apiErrorOptions)).rejects.toMatchObject({
    name: "BilibiliApiError",
    code: -111,
    message: "csrf校验失败",
  });
});
