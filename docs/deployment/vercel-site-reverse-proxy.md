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
  | HTTPS to origin IP:443
  v
Tencent Cloud ECS
  |
  +-- Nginx :443（源站 TLS 终止）
  |     |
  |     +-- proxy_pass http://127.0.0.1:3000
  |              |
  |              +-- Nuxt 4 / Nitro SSR（现有 PM2）
  |                       |
  |                       +-- SQLite / YAML / logs / system metrics
  |                       +-- Bot control 127.0.0.1:6365
  |
  +-- Nuxt :3000（保留原公网 IP 访问，供既有 bridge 调用方使用）
        +-- /api/bridge/*
```

用户访问网站时使用 Vercel 域名；既有桥接客户端仍直接访问 `http://<SERVER_IP>:3000/api/bridge/...`（若现有调用方已使用其他协议或端口，保持原样）。

Nginx 只新增 443 网站入口，不接管或改变现有 3000 端口。这样不会因调整监听地址而中断桥接调用方。

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
      "destination": "https://<ORIGIN_PUBLIC_IP>/$1"
    }
  ]
}
```

实施时将 `<ORIGIN_PUBLIC_IP>` 替换为腾讯云公网 IPv4，不要把占位符提交为可部署配置。若 Vercel 对正则 rewrite 的配置校验不接受该表达式，先按 Vercel 当前文档调整并在 Preview Deployment 验证；不得退化成会把 bridge 请求转发到源站的无条件 catch-all。

路由行为：

- `/`、`/pushes`、`/danmu`、`/logs`、`/system`、`/settings` 及其静态资源：转发到源站。
- 所有业务 API：转发到源站。
- `/api/bridge` 与 `/api/bridge/*`：由 Vercel 返回本地静态说明页，绝不访问源站。
- `/api/health`：仍按普通网站 API 代理；只有 bridge 明确排除。
- 查询参数必须原样保留。
- 不添加缓存配置，不添加 `x-vercel-enable-rewrite-caching`。该站点含登录态、实时状态和动态 API，外部 rewrite 默认不缓存，保持此行为。

`bridge-disabled.html` 应是简洁的纯静态页面，明确提示桥接 API 不通过此域名提供，请调用方继续使用现有源站 IP / 端口；不要包含真实公网 IP、Token 或其他秘密。

## 5. 源站 HTTPS：上线前置条件

Vercel 到腾讯云源站的链路必须使用经过公开信任验证的 HTTPS。不要把管理口令、登录请求和管理 API 通过 Vercel → 源站的明文 HTTP 传输。

当前 Nuxt 服务默认是 HTTP `:3000`，因此需要在源站增加 Nginx `:443`，TLS 终止后反代到 `http://127.0.0.1:3000`。保留原有 Nuxt 进程和端口。

### 5.1 不使用源站域名时的 IP 证书路线

截至 2026 年，Let's Encrypt 已正式支持短期 IP 地址证书。IP 证书有效期约 160 小时，必须自动续期。Certbot 5.4+ 提供 `--ip-address` 和 `--preferred-profile shortlived`；其 Nginx / Apache installer 尚不支持 IP 证书，因此使用 webroot 或 standalone 签发，再通过 deploy hook 让 Nginx 重新加载证书。

实施前检查系统发行版、Certbot 版本、Nginx 现有配置和 80/443 端口占用。示例签发命令（路径需按服务器实际情况设置）：

```bash
sudo certbot certonly \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path /var/www/letsencrypt \
  --ip-address <ORIGIN_PUBLIC_IP>
```

Nginx 的 80 端口需要正确提供 `/.well-known/acme-challenge/`，以便 HTTP-01 验证；其余 HTTP 请求可拒绝或跳转到 HTTPS。证书签发后使用 `certbot certificates` 确认实际证书路径、SAN 中包含 IP 地址及到期时间。配置自动续期，并设置 deploy hook 执行 `nginx -t && systemctl reload nginx`。必须验证自动续期任务确实启用，不能依赖人工每六天更新。

如果当前操作系统 / Certbot 无法可靠实现 IP 证书的自动续期，不要降级为明文 HTTP 上线。可另行评估使用具备有效证书的源站主机名，但那会引入域名解析到大陆源站的额外部署与合规考量，需由部署者单独决定。

### 5.2 Nginx 反代要求

Nginx 监听 `:443`，使用 IP SAN 证书，反代到现有 Nuxt `127.0.0.1:3000`。配置至少应满足：

- `proxy_http_version 1.1`。
- 转发原始 Host 信息；保留 Vercel 传入的 `X-Forwarded-Host`（如存在）。
- 明确设置 `X-Forwarded-Proto https`，确保 Nuxt 创建的登录 Cookie 带 `Secure`。
- 设置 `X-Real-IP` 和 `X-Forwarded-For`，但不要把这些头当成可信身份凭据。
- 允许正常的请求体和响应流；不缓存 HTML、登录响应或 API。
- 不设置过短的 read timeout；但 bridge 不经过该入口，因此无需为 55 秒 bridge 长轮询专门延长 Vercel 代理超时。
- 先 `nginx -t`，再 reload；不要覆盖服务器已有 Nginx 配置。

重要：Vercel External Rewrite 对 Host / forwarded headers 的实际传递必须在 Preview 环境实测。不能假定 `Host`、`X-Forwarded-Host` 一定等于浏览器地址栏域名。

## 6. Nuxt 鉴权与 Cookie 兼容

重点审查 `apps/site/server/middleware/auth.ts` 和 `apps/site/server/utils/configAuth.ts`。

当前写请求校验会比较浏览器 `Origin` 与 H3 根据 forwarded headers 计算出的 request origin。经 Vercel 外部 rewrite 后，源站看到的 Host 可能是源站 IP，因此需要实际验证：

1. 登录 POST 成功。
2. 登录响应中的 `nana_session` Cookie 带 `HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`，且浏览器将其存储在 Vercel 公共域名下。
3. 登录后刷新页面仍保持登录。
4. 设置页的 POST 请求通过 Origin / Fetch Metadata 校验。
5. 退出登录能正确清除 Cookie。

若 Origin 校验失败，优先采用显式配置的可信公共 Origin 白名单，例如新增 `NANA_SITE_PUBLIC_ORIGIN=https://<VERCEL_PUBLIC_HOST>`，只允许精确匹配的 origin；保留现有同源判断，不要关闭 Origin 校验，不要接受任意 `*.vercel.app`，也不要信任客户端可随意提交的 forwarded host。补充单元测试覆盖直连源站和 Vercel 代理两种模式。

不要把 `NANA_AUTH_TOKEN`、`NANA_BRIDGE_TOKEN` 或其他秘密配置到 Vercel 环境变量；它们继续只保存在腾讯云项目根目录的 `.env`。

## 7. 源站暴露与安全边界

- Vercel 代理不会隐藏源站公网 IP；知道 IP 的客户端仍可能直接访问现有 3000 端口。
- Vercel 也不会自动让源站只接受来自 Vercel 的流量。不要在没有确认 Vercel 固定出口能力前写死来源 IP 白名单。
- 当前 bridge 调用方需要继续直连公网 IP，因此不能简单关闭 3000 端口或把 Nuxt 监听改成仅 `127.0.0.1`。
- 站点现有全站登录鉴权必须保留；公开健康检查和 bridge 既有权限策略保持原样。
- 源站 443 应只提供必要的站点入口；SSH、Bot 控制端口 6365、数据库和文件目录不得因本次改造新增公网暴露。
- Nginx / Vercel 不得记录 Cookie、Authorization、管理口令或请求体中的敏感字段。
- 不启用外部 rewrite 缓存，避免缓存个人登录态或动态管理数据。

## 8. 实施步骤

1. 在仓库建立 `deploy/vercel-site-proxy/`，添加 `vercel.json`、bridge 静态拒绝页和目录 README。
2. 检查腾讯云系统、现有端口、防火墙和 Nginx 状态；备份将要修改的 Nginx 配置。
3. 为源站公网 IP 签发并配置有效 HTTPS 证书，配置自动续期和 Nginx 443 反代；不改动现有 3000 服务。
4. 在本机验证 `https://<ORIGIN_PUBLIC_IP>/api/health` 的证书链、HTTP 状态和源站响应。
5. 在 Vercel 新建项目，Root Directory 指向 `deploy/vercel-site-proxy`，不配置 Nuxt Build Command，不添加秘密环境变量。
6. 先使用 Preview Deployment 测试代理，再绑定正式域名。
7. 若代理后的登录 Origin 校验不兼容，再按第 6 节添加精确的 `NANA_SITE_PUBLIC_ORIGIN` 支持与测试。
8. 完成验收后记录 Vercel 项目、域名、源站证书续期方式和回滚方法。

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
- [ ] 浏览器没有 mixed content 或证书错误。
- [ ] Vercel 和 Nginx 均未缓存登录态或动态 API。
- [ ] Vercel 配置和 Git 历史中没有真实 IP 以外的秘密信息、Token 或私钥；公网 IP 是否写入仓库由部署者决定，默认通过占位符和项目配置管理。

### 运维

- [ ] PM2 仍按原方式运行，现有部署脚本不受影响。
- [ ] Nginx 配置测试通过，reload 不影响 3000 端口。
- [ ] IP 证书自动续期定时任务已启用，deploy hook 能 reload Nginx。
- [ ] Vercel 部署失败时，直接源站访问和 bridge 调用仍然可用。
- [ ] 回滚只需将 Vercel 项目恢复到上一部署或移除域名绑定；无需回滚 Nuxt 应用。

## 10. 回滚方案

Vercel 代理是附加入口，不替换现有源站入口。发生问题时：

1. 在 Vercel 将生产流量回滚到上一个成功部署，或暂时解除自定义域名。
2. 继续使用现有腾讯云 IP 和端口访问 Site。
3. bridge 调用方不需要改动。
4. 不停止 PM2，不回滚 NanaBot 业务代码。
5. 若 Nginx 443 配置有问题，只回滚新增的 443 server 配置；保留既有 3000 服务和 bridge 访问。

## 11. 官方参考

- Vercel External Rewrites：<https://vercel.com/docs/routing/rewrites>
- Vercel `vercel.json` 配置：<https://vercel.com/docs/project-configuration/vercel-json>
- Vercel Request Headers（`x-forwarded-host` / `x-forwarded-proto`）：<https://vercel.com/docs/headers/request-headers>
- Let's Encrypt IP 地址证书 GA 公告：<https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability>
- Certbot IP 证书用法：<https://letsencrypt.org/2026/03/11/shorter-certs-certbot>
