# 0014 Site Linux CI 构建与产物部署

- **状态**：已完成
- **日期**：2026-11-12
- **影响范围**：GitHub Actions、site 部署脚本与文档
- **关联需求**：1.8 GiB 内存的服务器执行 Nuxt/Nitro 构建时容易 OOM，希望把 site 构建移出服务器。
- **关联条目**：[上一条](./0013-low-memory-deploy.md) · [返回概览](./README.md)

## 背景

site 的 `.output` 包含 `@node-rs/jieba` 与 `@resvg/resvg-js` 的平台原生模块。在 macOS
构建出的产物是 Darwin ARM64，不能直接部署到 Linux x64 服务器，因此需要由 Linux 环境构建。

## 变更内容

| 文件                            | 类型 | 说明                                             |
| ------------------------------- | ---- | ------------------------------------------------ |
| `.github/workflows/site.yml`    | 新增 | Linux x64 构建、artifact 上传、可选 SSH 原子部署 |
| `scripts/deploy-site-output.sh` | 新增 | 服务器端解包、切换 `.output`、重启与失败回滚     |
| `README.md`                     | 修改 | 补充 GitHub Actions 构建与部署说明               |
| `apps/site/README.md`           | 修改 | 补充 site 的 CI 构建说明                         |

## 关键决策与取舍

- 使用 GitHub Actions 的 Ubuntu 24.04 x64 环境构建，与目标服务器保持一致。
- 先按拓扑顺序构建 `@nana/site` 的 workspace 依赖，再执行 Nuxt/Nitro 构建。
- 构建产物始终上传为 workflow artifact；未配置部署 secrets 时只构建、不部署。
- 配置 `DEPLOY_*` secrets 后自动部署，服务器不再执行 `pnpm install` 或 Nuxt 构建。
- 服务器端先解包到临时目录，验证 `server/index.mjs` 后再原子替换 `.output`。
- 重启后请求 `http://127.0.0.1:3000/` 做健康检查；失败时恢复旧 `.output` 并重启。

## 兼容性与数据安全

- `.output` 仍是原 PM2 启动入口，不改变数据库、配置或 API 契约。
- 部署只替换 site 产物，不修改 bot、`db/`、`nana.config.yaml` 或 `.env`。
- 旧 `.output` 在健康检查通过后才删除；失败时回滚。

## 验证

| 验证                   | 命令 / 方式                        | 结果                                    |
| ---------------------- | ---------------------------------- | --------------------------------------- |
| 格式化、lint、类型检查 | `pnpm exec vp check`               | 通过：0 errors，18 个既有 monitor 警告  |
| 部署脚本成功路径       | 临时 tarball + `pm2` / `curl` shim | 通过：产物切换、重启、清理均正常        |
| 部署脚本回滚路径       | 临时 tarball + 健康检查失败 shim   | 通过：恢复旧 `.output` 并重启           |
| GitHub Actions 配置    | YAML 解析、`actionlint`            | 通过                                    |
| 干净 worktree 构建     | 无 `nana.config.yaml` 的独立目录   | 通过：先构建 7 个依赖，再完成 site 构建 |

## 未决事项 / 后续可选项

- 当前按 Linux x64 glibc 构建；若服务器改为 ARM64 或 musl，需要调整 runner 或容器构建。
- 没有配置部署 secrets 时，需要在 Actions 页面下载 artifact，再手动上传并执行部署脚本。
