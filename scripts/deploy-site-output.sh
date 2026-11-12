#!/usr/bin/env bash
set -euo pipefail

artifact="${1:-}"
health_attempts="${SITE_HEALTH_ATTEMPTS:-10}"
pm2_config="${SITE_PM2_CONFIG:-apps/site/ecosystem.config.cjs}"

if [ -z "$artifact" ] || [ ! -f "$artifact" ]; then
  echo "usage: bash deploy-site-output.sh <site-output.tar.gz> [project-root]" >&2
  exit 2
fi

# 保留调用者传入的相对产物路径，切换到项目目录后仍能正确读取。
artifact="$(cd "$(dirname "$artifact")" && pwd)/$(basename "$artifact")"
project_root="${2:-$(pwd)}"
cd "$project_root"

# 以服务器上的 PM2 配置为准；仓库根的 .output 并不是 site 的启动目录。
deployment_config="$(node - "$pm2_config" <<'NODE'
const { resolve, dirname, basename } = require("node:path");
const config = require(resolve(process.argv[2]));
const app = config.apps?.find((entry) => entry.name === "@nana/site");
if (!app || typeof app.script !== "string") throw new Error("PM2 配置缺少 @nana/site 启动入口");
const cwd = resolve(app.cwd || process.cwd());
const entry = resolve(cwd, app.script);
const output = dirname(dirname(entry));
if (basename(entry) !== "index.mjs" || basename(dirname(entry)) !== "server" || basename(output) !== ".output")
  throw new Error("site 启动入口必须指向 .output/server/index.mjs");
const env = { ...process.env, ...app.env };
const port = Number(env.NITRO_PORT || app.port || env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("site 端口配置无效");
console.log(output);
console.log(`http://127.0.0.1:${port}/api/health`);
NODE
)"
{
  IFS= read -r output_dir
  IFS= read -r default_health_url
} <<< "$deployment_config"
health_url="${SITE_HEALTH_URL:-$default_health_url}"
echo "Deploying site output to $output_dir"
echo "Checking site health at $health_url"

next="${output_dir}.next.$$"
previous="${output_dir}.prev.$$"
cleanup() {
  rm -rf "$next"
  if [ ! -d "$output_dir" ] && [ -d "$previous" ]; then
    mv "$previous" "$output_dir"
  fi
}
trap cleanup EXIT

rm -rf "$next" "$previous"
mkdir "$next"
tar -xzf "$artifact" -C "$next"
test -f "$next/server/index.mjs"

if [ -d "$output_dir" ]; then
  mv "$output_dir" "$previous"
fi
mv "$next" "$output_dir"

rollback() {
  rm -rf "$output_dir"
  if [ -d "$previous" ]; then
    mv "$previous" "$output_dir"
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
  echo "Site health check failed at $health_url; rolling back." >&2
  rollback
  exit 1
fi

rm -rf "$previous"
rm -f "$artifact"
