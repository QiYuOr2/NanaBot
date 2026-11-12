#!/usr/bin/env bash
set -euo pipefail

artifact="${1:-}"
health_url="${SITE_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
health_attempts="${SITE_HEALTH_ATTEMPTS:-10}"
pm2_config="${SITE_PM2_CONFIG:-apps/site/ecosystem.config.cjs}"

if [ -z "$artifact" ] || [ ! -f "$artifact" ]; then
  echo "usage: bash deploy-site-output.sh <site-output.tar.gz> [project-root]" >&2
  exit 2
fi

project_root="${2:-$(pwd)}"
cd "$project_root"

next=".output.next.$$"
previous=".output.prev.$$"
cleanup() {
  rm -rf "$next"
  if [ ! -d .output ] && [ -d "$previous" ]; then
    mv "$previous" .output
  fi
}
trap cleanup EXIT

rm -rf "$next" "$previous"
mkdir "$next"
tar -xzf "$artifact" -C "$next"
test -f "$next/server/index.mjs"

if [ -d .output ]; then
  mv .output "$previous"
fi
mv "$next" .output

rollback() {
  rm -rf .output
  if [ -d "$previous" ]; then
    mv "$previous" .output
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
