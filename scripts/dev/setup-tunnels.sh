#!/usr/bin/env bash
# Provision per-developer Cloudflare Tunnels for the custom's dev stack.
# Usage: ./scripts/dev/setup-tunnels.sh <username>
# Example: ./scripts/dev/setup-tunnels.sh juan
#
# Creates one tunnel per service named "<username>-<client>-<service>", routes
# "<client>-<service>-<username>.daguito.com" at it, and writes a config at
# ~/.cloudflared/configs/<client>-<service>-<username>.yml.
#
# Why public hostnames and not localhost: Daguito's app imports the panel as a
# cross-origin ESM module and the browser calls the API from that origin. Both
# need real HTTPS on the daguito.com zone — the same reason Daguito exposes its
# own dev services at *-<user>.daguito.com instead of *.local.
#
# Hostnames stay two levels deep (pediatric-api-juan.daguito.com, NOT
# api.pediatric-juan.daguito.com) so Cloudflare's universal *.daguito.com
# certificate covers them; prod is pediatric-api.daguito.com for the same reason.
#
# Idempotent: existing tunnels/DNS records are reused. Safe to re-run.
#
# Requires:
#   - cloudflared installed (`brew install cloudflared`)
#   - Authenticated against the daguito.com zone (`cloudflared tunnel login`)

set -euo pipefail

user="${1:?usage: setup-tunnels.sh <username>}"
# Overridable so a copied custom only changes this one value (like client_name
# in prod.tfvars).
client="${CLIENT:-pediatric}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "✗ cloudflared not installed. Run: brew install cloudflared"
  exit 1
fi

if [[ ! -f "$HOME/.cloudflared/cert.pem" ]]; then
  echo "✗ Not logged in to Cloudflare. Run: cloudflared tunnel login"
  exit 1
fi

# The ports come from infra/.env, not from the defaults.
#
# They used to be read from the shell alone (`${API_PORT:-4101}`), and a custom
# that moved its ports so it could run beside another one — which is the whole
# reason the ports are configurable — got tunnels pointed at the OTHER custom's
# stack: real HTTPS hostnames serving somebody else's API, with no error
# anywhere. Same fallback shape tunnel.sh uses for the dev slug.
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
env_file="$repo_root/infra/.env"
read_env() {
  local key="$1" fallback="$2" line=""
  if [[ -f "$env_file" ]]; then
    line="$(grep -E "^$key=" "$env_file" | tail -1 || true)"
  fi
  if [[ -z "$line" ]]; then
    printf '%s' "$fallback"
    return
  fi
  line="${line#*=}"
  line="${line%%[[:space:]]*}"
  line="${line%\"}"; line="${line#\"}"
  printf '%s' "${line:-$fallback}"
}

# service:host-port — must match infra/.env (API_PORT / PANEL_PORT).
SERVICES=(
  "api:${API_PORT:-$(read_env API_PORT 4101)}"
  "panel:${PANEL_PORT:-$(read_env PANEL_PORT 4102)}"
)

mkdir -p "$HOME/.cloudflared/configs"

for entry in "${SERVICES[@]}"; do
  svc="${entry%%:*}"
  port="${entry##*:}"
  tunnel_name="$user-$client-$svc"
  hostname="$client-$svc-$user.daguito.com"
  config="$HOME/.cloudflared/configs/$client-$svc-$user.yml"

  echo "→ $tunnel_name ($hostname → localhost:$port)"

  tunnel_id="$(cloudflared tunnel list -o json 2>/dev/null \
    | grep -B1 "\"name\": \"$tunnel_name\"" \
    | grep '"id"' | head -1 \
    | sed -E 's/.*"id": "([^"]+)".*/\1/' || true)"

  if [[ -z "$tunnel_id" ]]; then
    create_out="$(cloudflared tunnel create "$tunnel_name" 2>&1)"
    tunnel_id="$(echo "$create_out" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
    echo "    created tunnel id $tunnel_id"
  else
    echo "    tunnel exists, id $tunnel_id"
  fi

  # --overwrite-dns so re-provisioning (e.g. after losing ~/.cloudflared and
  # recreating tunnels with new IDs) repoints the CNAME instead of leaving it
  # aimed at the deleted tunnel — which surfaces as Cloudflare error 1033.
  cloudflared tunnel route dns --overwrite-dns "$tunnel_name" "$hostname" 2>&1 \
    | grep -vE '^$' | sed 's/^/    /' || true

  cat > "$config" <<YML
tunnel: $tunnel_name
credentials-file: $HOME/.cloudflared/$tunnel_id.json
ingress:
  - hostname: $hostname
    service: http://localhost:$port
  - service: http_status:404
YML
  echo "    wrote $config"
done

cat <<TXT

✓ tunnels provisioned for user '$user' (client '$client')

Next:
  1. In infra/.env set
       PEDIATRIC_TUNNEL_USER=$user
       PANEL_PUBLIC_HOST=$client-panel-$user.daguito.com
       ALLOWED_ORIGIN=<Daguito's dev origin>,https://$client-panel-$user.daguito.com
  2. docker compose -f infra/docker-compose.dev.yml up -d
  3. ./scripts/dev/tunnel.sh                      # runs api + panel tunnels

Then Daguito loads the panel from
  https://$client-panel-$user.daguito.com/panel.js
with apiBase
  https://$client-api-$user.daguito.com
TXT
