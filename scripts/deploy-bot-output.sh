#!/usr/bin/env bash
set -euo pipefail

artifact="${1:-}"
health_attempts="${BOT_HEALTH_ATTEMPTS:-20}"
pm2_config="${BOT_PM2_CONFIG:-apps/bot/ecosystem.config.cjs}"

if [ -z "$artifact" ] || [ ! -f "$artifact" ]; then
  echo "usage: bash deploy-bot-output.sh <bot-output.tar.gz> [project-root]" >&2
  exit 2
fi

# 保留调用者传入的相对产物路径，切换到项目目录后仍能正确读取。
artifact="$(cd "$(dirname "$artifact")" && pwd)/$(basename "$artifact")"
project_root="${2:-$(pwd)}"
cd "$project_root"
project_root="$(pwd)"

# 部署标记：重启窗口内 bot 若发出离线/恢复告警，会据此改用「部署中」措辞。脚本退出时由 cleanup 删除。
marker="${project_root}/.deploying.json"
marker_tmp="${marker}.tmp.$$"

# 以服务器上的 PM2 配置为准；产物只替换 bot 的 dist 与 node_modules，不触碰同目录的 .env、配置与日志。
deployment_config="$(node - "$pm2_config" <<'NODE'
const { readFileSync, existsSync } = require("node:fs");
const { resolve, dirname, basename, join } = require("node:path");
const config = require(resolve(process.argv[2]));
const app = config.apps?.find((entry) => entry.name === "@nana/bot");
if (!app || typeof app.script !== "string") throw new Error("PM2 配置缺少 @nana/bot 启动入口");
const cwd = resolve(app.cwd || process.cwd());
const entry = resolve(cwd, app.script);
const dist = dirname(entry);
const appDir = dirname(dist);
if (basename(entry) !== "index.mjs" || basename(dist) !== "dist")
  throw new Error("bot 启动入口必须指向 dist/index.mjs");
// 控制端口与 bot 本体保持一致：优先 apps/bot/.env 的 NANA_BOT_CONTROL_PORT，否则用默认值。
let port = 6365;
const envFile = join(appDir, ".env");
if (existsSync(envFile)) {
  const match = readFileSync(envFile, "utf8").match(
    /^\s*NANA_BOT_CONTROL_PORT\s*=\s*"?(\d{1,5})"?\s*$/m,
  );
  if (match) port = Number(match[1]);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("bot 控制端口配置无效");
console.log(appDir);
console.log(`http://127.0.0.1:${port}/health`);
NODE
)"
{
  IFS= read -r app_dir
  IFS= read -r default_health_url
} <<< "$deployment_config"
health_url="${BOT_HEALTH_URL:-$default_health_url}"
echo "Deploying bot output to $app_dir"
echo "Checking bot health at $health_url"

stage="${app_dir}/.bot-output.next.$$"
dist_dir="${app_dir}/dist"
modules_dir="${app_dir}/node_modules"
dist_prev="${app_dir}/dist.prev.$$"
modules_prev="${app_dir}/node_modules.prev.$$"

cleanup() {
  rm -rf "$stage"
  rm -f "$marker" "$marker_tmp"
  # 若在替换中途退出，恢复被移走的旧目录，避免 bot 失去可启动的产物。
  if [ ! -d "$dist_dir" ] && [ -d "$dist_prev" ]; then
    mv "$dist_prev" "$dist_dir"
  fi
  if [ ! -d "$modules_dir" ] && [ -d "$modules_prev" ]; then
    mv "$modules_prev" "$modules_dir"
  fi
}
trap cleanup EXIT

rm -rf "$stage" "$dist_prev" "$modules_prev"
mkdir -p "$stage"
tar -xzf "$artifact" -C "$stage"
test -f "$stage/dist/index.mjs"
test -d "$stage/node_modules"

# 先落部署标记再动产物，保证整个重启窗口都在标记覆盖之内。
deploy_ref="$(printf '%s' "${BOT_DEPLOY_REF:-}" | tr -cd 'A-Za-z0-9._-' | head -c 64)"
printf '{"startedAt":"%s","ref":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$deploy_ref" > "$marker_tmp"
mv "$marker_tmp" "$marker"

if [ -d "$dist_dir" ]; then
  mv "$dist_dir" "$dist_prev"
fi
mv "$stage/dist" "$dist_dir"

if [ -d "$modules_dir" ]; then
  mv "$modules_dir" "$modules_prev"
fi
mv "$stage/node_modules" "$modules_dir"

rollback() {
  rm -rf "$dist_dir" "$modules_dir"
  if [ -d "$dist_prev" ]; then
    mv "$dist_prev" "$dist_dir"
  fi
  if [ -d "$modules_prev" ]; then
    mv "$modules_prev" "$modules_dir"
  fi
  pm2 startOrRestart "$pm2_config" || true
}

if ! pm2 startOrRestart "$pm2_config"; then
  echo "PM2 restart failed; rolling back." >&2
  rollback
  exit 1
fi

healthy=0
for _ in $(seq 1 "$health_attempts"); do
  sleep 1
  if curl --fail --silent --show-error --max-time 2 "$health_url" >/dev/null; then
    healthy=1
    break
  fi
done

if [ "$healthy" -ne 1 ]; then
  echo "Bot health check failed at $health_url; rolling back." >&2
  rollback
  exit 1
fi

rm -rf "$dist_prev" "$modules_prev"
rm -f "$artifact"
