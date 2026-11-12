# @nana/qq

QQ 官方机器人通信包，底层使用腾讯的 `@tencent-connect/qqbot-nodejs`。
只负责连接、消息编码、事件归一化和发送结果校验；配置、账号路由、群映射、数据库和业务日志由调用方处理。

```ts
import { QQClient, QQSendError } from "@nana/qq";

const client = new QQClient({ appId, appSecret, accountId: "main", logger: console });
client.on("connected", () => console.info("机器人已连接"));
client.on("disconnected", ({ code, willReconnect }) => console.info(code, willReconnect));
client.on("groupDiscovered", ({ openid, source }) => console.info(openid, source));
client.on("error", (error) => console.error(error));

const controller = new AbortController();
// start() 在连接生命周期内保持 pending，到 stop/abort 时结束；致命错误会拒绝。
const connected = new Promise<void>((resolve) => client.on("connected", resolve));
const run = client.start(controller.signal);
try {
  // 在 connected 与运行任务结束之间等待，避免连接失败时永远等待就绪。
  await Promise.race([
    connected,
    run.then(() => {
      throw new Error("连接已结束");
    }),
  ]);
  await client.sendGroupMessage(groupOpenid, [
    { type: "text", text: "开播了 " },
    { type: "atAll" },
  ]);
} catch (error) {
  if (error instanceof QQSendError) console.error(error.code, error.message);
  else throw error;
} finally {
  client.stop();
  await run;
}
```

`on()` 返回取消订阅函数。READY 与 RESUMED 统一为 `connected`；群消息与机器人入群事件
统一为 `groupDiscovered`，忽略单聊等无关事件。SDK 负责 token 刷新、Gateway 心跳和重连。

`sendGroupMessage()` 接收官方 `group_openid` 和独立的 `QQMessagePart[]`：

- `{ type: "text", text }`：文本；
- `{ type: "atAll" }`：转换为 `<qqbot-at-everyone />`，需群管理员权限，每群每天仅一次；
- `{ type: "image", source }`：图片，`source` 可为本地路径、URL、`file://`、`base64://` 或字节。

一条消息最多一张图片，文本作为图片正文发送。@全体仅用于文本，不能与媒体消息合并。
发送成功返回 `{ id, timestamp? }`；平台错误、HTTP 200 的业务错误及缺失消息 ID 都会抛出
`QQSendError`。平台业务错误码保留在 `code`，底层错误保留在 `cause`；不降级成无 @全体的消息重发。

扫码入口单独导出，主通信入口不加载二维码模块：

```ts
import { connectQQRobot } from "@nana/qq/connect";

const credentials = await connectQQRobot({ signal: controller.signal });
// 返回 QQCredentials[]，由调用方安全保存；此包不读取或写入 .env。
```
