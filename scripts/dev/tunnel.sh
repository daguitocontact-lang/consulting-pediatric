#!/usr/bin/env bash
# Run the per-developer Cloudflare Tunnels for this custom's dev stack.
#
#   ./scripts/dev/tunnel.sh          # all services (api + panel), concurrently
#   ./scripts/dev/tunnel.sh api      # just one
#
# The dev slug comes from PEDIATRIC_TUNNEL_USER (shell env, or infra/.env). Configs
# are the ones written by scripts/dev/setup-tunnels.sh.
#
# On a machine without cloudflared this exits 0 silently, so it can be wired
# into a dev task without breaking anyone who doesn't tunnel.

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
client="${CLIENT:-pediatric}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "[tunnel] skipped: cloudflared not installed"
  exit 0
fi

# Fall back to infra/.env for the slug. Strip quotes and any trailing whitespace
# (a CR from a Windows-edited .env would otherwise land in the config filename
# and fail the lookup with a confusing "not found").
env_file="$repo_root/infra/.env"
if [[ -z "${PEDIATRIC_TUNNEL_USER:-}" && -f "$env_file" ]]; then
  user_line="$(grep -E '^PEDIATRIC_TUNNEL_USER=' "$env_file" | tail -1 || true)"
  if [[ -n "$user_line" ]]; then
    PEDIATRIC_TUNNEL_USER="${user_line#PEDIATRIC_TUNNEL_USER=}"
    PEDIATRIC_TUNNEL_USER="${PEDIATRIC_TUNNEL_USER%%[[:space:]]*}"
    PEDIATRIC_TUNNEL_USER="${PEDIATRIC_TUNNEL_USER%\"}"; PEDIATRIC_TUNNEL_USER="${PEDIATRIC_TUNNEL_USER#\"}"
    PEDIATRIC_TUNNEL_USER="${PEDIATRIC_TUNNEL_USER%\'}"; PEDIATRIC_TUNNEL_USER="${PEDIATRIC_TUNNEL_USER#\'}"
  fi
fi

if [[ -z "${PEDIATRIC_TUNNEL_USER:-}" ]]; then
  echo "[tunnel] skipped: PEDIATRIC_TUNNEL_USER not set (shell env or infra/.env)"
  echo "[tunnel] run: ./scripts/dev/setup-tunnels.sh <username>"
  exit 0
fi

services=("$@")
if [[ ${#services[@]} -eq 0 ]]; then services=(api panel); fi

pids=()
# Kill every child tunnel on Ctrl-C / exit, otherwise they survive the script
# and keep the hostnames pointed at a dev stack that is no longer running.
cleanup() { for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

for svc in "${services[@]}"; do
  config="$HOME/.cloudflared/configs/$client-$svc-$PEDIATRIC_TUNNEL_USER.yml"
  if [[ ! -f "$config" ]]; then
    echo "[tunnel] skipped $svc: $config not found"
    echo "[tunnel] run: ./scripts/dev/setup-tunnels.sh $PEDIATRIC_TUNNEL_USER"
    continue
  fi
  echo "[tunnel] $svc → https://$client-$svc-$PEDIATRIC_TUNNEL_USER.daguito.com"
  cloudflared tunnel --config "$config" run &
  pids+=($!)
done

if [[ ${#pids[@]} -eq 0 ]]; then
  echo "[tunnel] nothing to run"
  exit 0
fi

wait
