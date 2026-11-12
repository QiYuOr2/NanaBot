# 0016 修正 Site CI 部署目录

- **日期**：2026-11-12
- **影响范围**：site 产物部署脚本、CI 验证与文档。

## 原因

运行 `43158577765` 的安装、构建、Linux 产物验证及上传均成功。
部署时 PM2 重启成功，但 `/api/health` 连续返回 404，随后回滚。
下载该次 artifact 后确认其中包含 `health.get.mjs`，不是健康检查接口漏打包。

旧脚本以 `DEPLOY_PATH`（仓库根目录）为当前目录，将产物切换至根目录 `.output`。
PM2 的 `cwd` 和 `script` 实际指向 `apps/site/.output/server/index.mjs`，
因此重启仍读取旧产物。此前检查首页时，旧站也能返回 200，掩盖了目录错误；
新增 `/api/health` 后暴露出来。

## 修复

- 从服务器 `SITE_PM2_CONFIG`（默认 `apps/site/ecosystem.config.cjs`）读取 `@nana/site`
  的启动路径，验证为 `.output/server/index.mjs` 后，在该目录旁解包并原子替换。
- 切换、失败回滚和清理统一使用同一个产物路径；不操作仓库根目录的同名 `.output`。
- 健康检查端口从相同配置及环境读取，保留 `SITE_HEALTH_URL` 覆盖能力。
- artifact 路径在切换到项目目录前转为绝对路径，支持从仓库外调用。
- CI 增加部署回归测试，并直接启动 Linux 构建产物请求 `/api/health`，之后再上传与部署。

## 验证

隔离目录按真实仓库结构放置 `apps/site/ecosystem.config.cjs`、
`apps/site/.output` 和一份无关的根目录 `.output`。
PM2 替身实际读取配置指向的启动文件；健康检查只在它读取到新版本且 URL 正确时成功。
用例覆盖部署成功、健康检查失败回滚、PM2 重启失败回滚及健康检查地址覆盖。
修复前成功路径可复现失败，修复后通过。

旧脚本留在仓库根目录的 `.output` 不会被本次脚本自动删除，以免误删其他文件。
