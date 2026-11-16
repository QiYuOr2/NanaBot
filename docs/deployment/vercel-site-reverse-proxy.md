# NanaBot Site：Vercel 反向代理部署方案

> 状态：实施方案（尚未部署）
> 目标分支：`v2`
> 适用范围：`apps/site` 当前 Nuxt 4 SSR 站点
> 方案性质：Vercel 只作为网站访问入口和反向代理；腾讯云继续运行完整 NanaBot Site。

## 1. 目标与边界

为 NanaBot Site 提供一个固定的 Vercel 域名或绑定到 Vercel 的自有域名。访问者在浏览器中始终使用该域名，Vercel 将网站请求转发到腾讯云服务器上的现有 Nuxt 服务。

本次不迁移 Nuxt，不做静态生成，不把业务 API 改造成 Vercel Functions，也不迁移 SQLite、YAML、日志或 Bot 控制服务。

明确排除：

- `/api/bridge` 与 `/api/bridge/*` 不经过 Vercel。现有桥接调用继续使用腾讯云公网 IP 和原端口，调用地址、鉴权及长轮询行为不变。
- 不改变 Bot、NapCat、QQ 接入、桥接协议和 `NANA_BOT_CONTROL_URL`。
- 不改变当前 PM2 构建、发布和重启流程。
- Vercel 不承担登录鉴权，不作为隐藏源站 IP 或访问控制边界。
- 本方案仅改善访问入口；不构成 ICP 备案豁免，也不改变源站对外提供服务的法律合规要求。

## 2. 当前项目现状

根据 `apps/site` 当前代码：

- Nuxt 4 + Nitro SSR，生产入口为 `.output/server/index.mjs`。
- PM2 进程名为 `@nana/site`，默认监听 `0.0.0.0:3000`。
- 页面与 `/api/*` 均由同一个 Nuxt 服务提供。
- 服务端依赖腾讯云本机文件和服务：项目配置 YAML、SQLite 数据库、日志、系统指标、词云渲染，以及 Bot 内部控制端口 `127.0.0.1:6365`。
- 全站管理登录使用 HttpOnly Cookie；`server/middleware/auth.ts` 对 API 做统一鉴权，并对写请求做 Origin / Fetch Metadata 检查。
- `/api/bridge/status` 支持最长 55 秒的长轮询，且桥接 API 由独立调用方直接访问。

因此应代理完整 SSR 站点，而不是执行 `nuxt generate`。

## 3. 目标架构

```text
Browser
  |
  | https://<VERCEL_PUBLIC_HOST>/*
  v
Vercel Project（仅配置层 + 静态 bridge 拒绝页）
  |
  | External Rewrite，保留 path / query / method / body
  | HTTP to origin IP:3000
  v
Tencent Cloud ECS
  |
  +-- Nuxt :3000（现有 PM2，保持原样）
           |
           +-- SQLite / YAML / logs / system metrics
           +-- Bot control 127.0.0.1:6365
           +-- /api/bridge/*（仅由既有调用方直连）
```

用户访问网站时使用 Vercel 域名；Vercel 将普通网站请求通过 HTTP 转发到 `http://<SERVER_IP>:3000`。既有桥接客户端仍直接访问 `http://<SERVER_IP>:3000/api/bridge/...`（若现有调用方已使用其他协议或端口，保持原样）。不新增 Nginx、TLS 证书或源站域名，也不改变现有 3000 端口。

## 4. Vercel 项目文件与路由

在仓库新增独立目录，例如：

```text
deploy/vercel-site-proxy/
  vercel.json
  bridge-disabled.html
  README.md
```

Vercel 项目 Root Directory 指向 `deploy/vercel-site-proxy`。不连接 Nuxt workspace，不执行 pnpm install / Nuxt build；这是一个轻量配置型静态部署项目。

建议路由配置：

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    {
      "source": "^/api/bridge(?:/.*)?$",
      "destination": "/bridge-disabled.html"
    },
    {
      "source": "^/(.*)$",
      "destination": "http://<ORIGIN_PUBLIC_IP>:3000/$1"
    }
  ]
}
```

实施时将 `<ORIGIN_PUBLIC_IP>` 替换为腾讯云公网 IPv4。注意：`vercel.json` 的 rewrite destination 不支持从 Vercel 环境变量插值，因此不能把源站地址写成运行时环境变量。源站公网 IP 本身不是凭据；本仓库为私有仓库，可将实际 IP 写入代理项目配置。若部署者不希望把 IP 放进 Git，应改用 Vercel Dashboard 的项目级路由配置，或在本地维护未提交的部署配置，而不是假设 `vercel.json` 会读取环境变量。若 Vercel 对正则 rewrite 的配置校验不接受该表达式，先按 Vercel 当前文档调整并在 Preview Deployment 验证；不得退化成会把 bridge 请求转发到源站的无条件 catch-all。

路由行为：

- `/`、`/pushes`、`/danmu`、`/logs`、`/system`、`/settings` 及其静态资源：转发到源站。
- 所有业务 API：转发到源站。
- `/api/bridge` 与 `/api/bridge/*`：由 Vercel 返回本地静态说明页，绝不访问源站。
- `/api/health`：仍按普通网站 API 代理；只有 bridge 明确排除。
- 查询参数必须原样保留。
- 不添加缓存配置，不添加 `x-vercel-enable-rewrite-caching`。该站点含登录态、实时状态和动态 API，外部 rewrite 默认不缓存，保持此行为。

`bridge-disabled.html` 应是简洁的纯静态页面，明确提示桥接 API 不通过此域名提供，请调用方继续使用现有源站 IP / 端口；不要包含真实公网 IP、Token 或其他秘密。

## 5. 源站 HTTP 转发与安全边界

Vercel External Rewrite 直接请求腾讯云公网 IPv4 的 `http://<ORIGIN_PUBLIC_IP>:3000`。本方案明确接受 Vercel 到源站之间使用明文 HTTP，不申请证书、不配置源站域名、不新增 Nginx，也不调整现有 Nuxt / PM2 部署。

链路分为两段：

- 浏览器 → Vercel：HTTPS，浏览器地址栏始终显示 Vercel 公共域名。
- Vercel → 腾讯云源站：HTTP，目标为 `http://<ORIGIN_PUBLIC_IP>:3000`。

必须理解明文链路的影响：Vercel 到源站之间的请求和响应内容没有传输层加密保护，可能被能够观察或干预该网络链路的第三方读取或篡改。登录请求、Cookie、管理 API 请求与响应也经过这段链路。因此这属于用户明确接受的安全取舍，不应将其描述为端到端 HTTPS 或安全的源站连接。

### 5.1 源站要求

- 保持当前 Nuxt 监听 `0.0.0.0:3000`，PM2 进程、启动命令和部署方式不变。
- 不要求绑定任何源站域名，不配置 DNS 记录。
- 不申请或续期 TLS 证书。
- 不新增 Nginx 或其他 TLS 终止层。
- 腾讯云安全组及系统防火墙需允许 Vercel 请求抵达 TCP 3000；现有 bridge 调用方也继续使用该端口。
- 不要把 `NANA_AUTH_TOKEN`、`NANA_BRIDGE_TOKEN` 或其他秘密配置到 Vercel；这些秘密继续只保存在腾讯云项目根目录的 `.env`。

### 5.2 Vercel 转发行为

- 仅代理普通页面、静态资源和业务 API。
- `/api/bridge` 与 `/api/bridge/*` 在 Vercel 侧命中本地静态拒绝页，不能转发到源站。
- 不启用 External Rewrite 缓存，不添加 `x-vercel-enable-rewrite-caching`。
- 不在 Vercel 项目中配置 Nuxt Build Command；该项目仍是独立的配置型部署项目。
- `vercel.json` rewrite destination 不支持环境变量插值，配置中使用实际 IP，或由部署者在本地维护未提交的配置。源站 IP 不是凭据。

`vercel.json` 示例：

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    {
      "source": "^/api/bridge(?:/.*)?$",
      "destination": "/bridge-disabled.html"
    },
    {
      "source": "^/(.*)$",
      "destination": "http://<ORIGIN_PUBLIC_IP>:3000/$1"
    }
  ]
}
```

在 Vercel Preview Deployment 中验证正则路由的实际匹配行为。若 Vercel 当前配置校验不接受该表达式，应按 Vercel 当前路由语法调整并实测；不得退化成会把 bridge 请求转发到源站的无条件 catch-all。

`bridge-disabled.html` 应是简洁的纯静态页面，明确提示桥接 API 不通过此域名提供，请调用方继续使用现有源站 IP / 端口；不要包含真实公网 IP、Token 或其他秘密。

## 6. Nuxt 鉴权与 Cookie 兼容

重点审查 `apps/site/server/middleware/auth.ts` 和 `apps/site/server/utils/configAuth.ts`。

浏览器访问 Vercel 公共域名，Cookie 由浏览器保存在该公共域名下；Vercel 将请求转发到源站 HTTP 服务。实施时必须在 Preview 环境验证：

1. 登录 POST 成功。
2. 登录响应中的 `nana_session` Cookie 按预期包含 `HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`，并由浏览器保存在 Vercel 公共域名下。由于浏览器侧仍是 HTTPS，不能因为源站链路为 HTTP 就擅自移除 `Secure`。
3. 登录后刷新页面仍保持登录。
4. 设置页的 POST 请求通过 Origin / Fetch Metadata 校验。
5. 退出登录能正确清除 Cookie。

当前写请求校验会比较浏览器 `Origin` 与 H3 根据 forwarded headers 计算出的 request origin。经 Vercel 外部 rewrite 后，源站看到的 Host 可能是源站 IP，因此需要实测。若 Origin 校验失败，优先采用显式配置的可信公共 Origin 白名单，例如新增 `NANA_SITE_PUBLIC_ORIGIN=https://<VERCEL_PUBLIC_HOST>`，只允许精确匹配的 origin；保留现有同源判断，不要关闭 Origin 校验，不要接受任意 `*.vercel.app`，也不要信任客户端可随意提交的 forwarded host。补充单元测试覆盖直连源站和 Vercel 代理两种模式。

注意：即使 Cookie 带有 `Secure`，也不能保护 Cookie 在 Vercel → 源站 HTTP 链路上的传输安全。该链路的明文风险已在第 5 节明确说明。

## 7. 源站暴露与安全边界

- Vercel 代理不会隐藏源站公网 IP；知道 IP 的客户端仍可能直接访问现有 3000 端口。
- Vercel 不会自动让源站只接受来自 Vercel 的流量。不要在没有确认 Vercel 固定出口能力前写死来源 IP 白名单。
- 当前 bridge 调用方需要继续直连公网 IP，因此不能简单关闭 3000 端口或把 Nuxt 监听改成仅 `127.0.0.1`。
- 站点现有全站登录鉴权必须保留；公开健康检查和 bridge 既有权限策略保持原样。
- SSH、Bot 控制端口 6365、数据库和文件目录不得因本次改造新增公网暴露。
- 不要在 Vercel 或应用日志中记录 Cookie、Authorization、管理口令或请求体中的敏感字段。
- 不启用外部 rewrite 缓存，避免缓存个人登录态或动态管理数据。
- Vercel → 源站使用 HTTP 是本方案已接受的风险：该链路上的请求与响应没有传输层加密，敏感内容存在被旁路观察或篡改的可能。不要误以为浏览器到 Vercel 的 HTTPS 同时保护了后半段链路。

## 8. 实施步骤

1. 在仓库建立 `deploy/vercel-site-proxy/`，添加 `vercel.json`、bridge 静态拒绝页和目录 README。
2. 将 rewrite 目标配置为 `http://<ORIGIN_PUBLIC_IP>:3000/$1`，替换为腾讯云实际公网 IPv4。
3. 检查腾讯云安全组和系统防火墙，确认 TCP 3000 可供 Vercel 访问，同时保持现有 bridge 调用方连通。
4. 在 Vercel 新建项目，Root Directory 指向 `deploy/vercel-site-proxy`，不配置 Nuxt Build Command，不添加秘密环境变量。
5. 先使用 Preview Deployment 测试代理和 bridge 排除规则，再绑定正式 Vercel 域名。
6. 验证登录、Cookie、Origin 校验和业务 API；若 Origin 校验不兼容，再按第 6 节添加精确的 `NANA_SITE_PUBLIC_ORIGIN` 支持与测试。
7. 记录 Vercel 项目配置、源站 IP:3000 和回滚方法。

本方案不执行源站 SSH 操作，不修改生产服务器，不安装 Nginx，不申请证书，不重启 PM2。源站现有 Nuxt 服务保持原样。

## 9. 验收清单

### 路由

- [ ] 访问 Vercel 域名根路径，得到与源站相同的 SSR 页面。
- [ ] `/pushes`、`/danmu`、`/logs`、`/system`、`/settings` 正常。
- [ ] Nuxt 生成的 JS、CSS、字体、图标和词云图片均正常加载。
- [ ] 带查询参数的请求转发后参数不丢失。
- [ ] `/api/bridge` 与 `/api/bridge/*` 命中 Vercel 静态拒绝页；源站访问日志确认这些请求没有抵达源站。
- [ ] 既有 bridge 客户端继续通过源站 IP 和原端口正常调用，包含长轮询。
- [ ] `/api/health` 按设计经 Vercel 转发。

### 鉴权与安全

- [ ] 未登录访问业务页面会进入登录页。
- [ ] 登录、刷新、Cookie 持久化、退出登录正常。
- [ ] 设置页写请求、Bot 测试消息请求正常。
- [ ] 不存在跨站写请求绕过。
- [ ] 浏览器到 Vercel 使用 HTTPS，无 mixed content。
- [ ] Vercel 未缓存登录态或动态 API。
- [ ] Vercel 配置和 Git 历史中没有 Token、私钥或其他秘密信息。
- [ ] 已知悉并接受 Vercel → 源站 HTTP 明文链路的风险。

### 运维

- [ ] PM2、Nuxt 3000 端口和现有部署脚本不受影响。
- [ ] 现有 bridge 调用方不需要改动。
- [ ] Vercel 部署失败时，直接源站访问和 bridge 调用仍然可用。
- [ ] 回滚只需将 Vercel 项目恢复到上一部署或移除域名绑定；无需回滚 Nuxt 应用。

## 10. 回滚方案

Vercel 代理是附加入口，不替换现有源站入口。发生问题时：

1. 在 Vercel 将生产流量回滚到上一个成功部署，或暂时解除 Vercel 域名绑定。
2. 继续使用现有腾讯云 IP 和端口访问 Site。
3. bridge 调用方不需要改动。
4. 不停止 PM2，不回滚 NanaBot 业务代码。
5. 本方案没有新增 Nginx、证书或源站配置，因此无需执行源站侧回滚。

## 11. 官方参考

- Vercel External Rewrites：<https://vercel.com/docs/routing/rewrites>
- Vercel `vercel.json` 配置：<https://vercel.com/docs/project-configuration/vercel-json>
