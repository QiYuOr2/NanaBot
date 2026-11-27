<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# NanaBot 开发约定

NanaBot 是基于 pnpm workspace 与 Vite+（`vp`）的 TypeScript Monorepo，包含机器人主程序 `apps/bot`、Nuxt 4 管理面板 `apps/site` 以及共享包 `packages/*`。功能概览与配置说明见 `README.md` 与 `nana.config.yaml.example`。

## 模块边界与代码规范

- **单一职责**：`src/` 按职责拆分，`index.ts` 只做导出桶（barrel）。
- **共享收口**：环境变量名、数据库文件名、推送目的（`PUSH_LOG_PURPOSES` / `PUSH_PURPOSE_LABELS`）等常量统一放 `@nana/constants`；项目根定位、鉴权口令读取（`readProjectAuthToken`）等通用逻辑放 `@nana/utils`，避免重复实现。
- **依赖隔离**：
  - 官方 QQ SDK（`@tencent-connect/qqbot-*`）只由 `@nana/qq` 依赖；该包不得依赖 NapCat、配置、存储或 bot 业务逻辑。
  - `@nana/wordcloud`、`@nana/live-summary` 保持纯计算/生成，不依赖 QQ 通道实现。
  - `apps/site` 不得依赖 `@nana/qq` 或读取机器人密钥；需要由机器人执行的动作（如测试发信）必须经 bot 本机控制接口转发。
- **原生依赖**：`@node-rs/jieba`、`@resvg/resvg-js` 在 `apps/bot` 构建配置中必须保持 external。

## 核心不变量（修改时必须遵守）

- **账号与通道隔离**：`up[].qqAccount` 必须显式指定，不做默认账号回退；通道选择严格以 `accounts[].provider` 为准；单账号停用、缺凭据或失败时只跳过自身，绝不改发到其他账号或切换通道。
- **发送失败与 `@all` 语义**：官方与 NapCat 通道发送成功与失败均需写推送日志，失败必须抛出原始错误；官方 `{@all}`（`<qqbot-at-everyone />`）发送失败时，**严禁**去掉提醒后降级为普通群消息重发。
- **配置编辑保注释**：通过 `@nana/config` 原子更新 `nana.config.yaml`（如 `accounts[].groups`）时保留原有 YAML 注释；群映射在发送时实时读取，不要求重启 bot。
- **安全与敏感信息**：
  - `apps/site` 除登录鉴权与 `/api/health` 外，其余业务页面与 API 均受 `NANA_AUTH_TOKEN` 保护；日志查看接口必须拒绝路径越界与符号链接。
  - 绝不向接口或日志输出密钥与敏感凭据（`AppSecret`、`BILIBILI_COOKIE`、管理口令等）；绝不提交 `.env`、`nana.config.yaml`、`db/*.sqlite`、`logs/`。

## 测试规范

- 测试目录为 `tests/`（`apps/bot` 为 `test/`），统一从 `vite-plus/test` 导入测试 API。
- 涉及存储、配置或文件系统的测试必须使用临时目录隔离，不得读写项目根目录的真实 `db/` 或 `nana.config.yaml`。

## 常用命令（仓库根目录）

- `vp check` —— 格式化、Lint 与类型检查
- `vp test` —— 运行全仓 Vitest 测试
- `pnpm build:bot` / `pnpm build:site` —— 构建 bot / site
- `pnpm dev:site` —— 启动 site 开发服务器
- `pnpm app <list|build|deploy|start|restart|stop|delete|logs> [应用名...|all]` —— 按应用管理构建与 PM2 进程
