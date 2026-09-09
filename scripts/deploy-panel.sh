#!/usr/bin/env bash
# Manual panel deploy — what deploy-panel.yml does, from a laptop.
#
# The API has had `scripts/deploy.sh` for the day CI is not an option; this is
# the other half. It exists because the panel deploy is not "upload a file":
# the content types, the 60s Cache-Control and the SECOND key the patient's
# page is published under are each a thing that fails quietly if it is typed
# from memory — a page served as application/octet-stream downloads instead of
# opening, and a missing `consulta` key is a patient link that 404s.
#
# Needs a Cloudflare API token with R2 Object Read & Write on the account:
#
#   CLOUDFLARE_API_TOKEN=… ./scripts/deploy-panel.sh
#
# or the same name in infra/.env, which is gitignored and is where the rest of
# the local credentials already live.
#
# CLOUDFLARE_ACCOUNT_ID is read from infra/terraform/envs/prod/prod.tfvars when
# it is not exported. CLOUDFLARE_PURGE_TOKEN (Zone:Zone:Read + Zone:Cache
# Purge:Purge on daguito.com) is optional: without it the release still lands
# within the 60s TTL, exactly as in CI.
set -euo pipefail
cd "$(dirname "$0")/.."

BUCKET=pediatric-panel
HOST=https://pediatric-panel.daguito.com
ZONE_NAME=daguito.com

# The token may live in infra/.env — the local, gitignored secrets file the dev
# stack already reads — so it survives a new shell instead of being pasted into
# each one.
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f infra/.env ]; then
  CLOUDFLARE_API_TOKEN=$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' infra/.env | tail -1)
fi
: "${CLOUDFLARE_API_TOKEN:?export it, or put CLOUDFLARE_API_TOKEN=… in infra/.env (needs R2 Object Read & Write)}"
export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(
  sed -n 's/^cloudflare_account_id *= *"\(.*\)"/\1/p' infra/terraform/envs/prod/prod.tfvars
)}"
: "${CLOUDFLARE_ACCOUNT_ID:?not exported and not found in prod.tfvars}"

echo "── build ──────────────────────────────────────────────"
(cd apps/panel && bun install --frozen-lockfile && bun run typecheck && bun run build)
ls -la apps/panel/dist/panel.js

put() { # key file content-type
  npx --yes wrangler@4 r2 object put "$BUCKET/$1" \
    --file="$2" \
    --content-type="$3" \
    --cache-control="public, max-age=60, must-revalidate" \
    --remote
}

echo "── upload ─────────────────────────────────────────────"
# The page goes up BEFORE the bundle it imports, and before any API that links
# to it: a key that does not exist yet is a link that 404s in somebody's hand.
# Two keys, same bytes — `consulta` is the route the API links to, and
# `patient.html` stays for the links already out there (12 h) and for dev.
for key in consulta patient.html; do
  put "$key" apps/panel/dist/patient.html "text/html; charset=utf-8"
done
put panel.js apps/panel/dist/panel.js "application/javascript; charset=utf-8"

echo "── purge ──────────────────────────────────────────────"
# Belt and braces on the 60s TTL, and the same fallback CI uses: an R2 token
# cannot purge, so this reports and moves on rather than failing the deploy.
purge_token="${CLOUDFLARE_PURGE_TOKEN:-$CLOUDFLARE_API_TOKEN}"
api=https://api.cloudflare.com/client/v4
zone=$(curl -sS -H "Authorization: Bearer $purge_token" "$api/zones?name=$ZONE_NAME" |
  python3 -c 'import json,sys; print((json.load(sys.stdin).get("result") or [{}])[0].get("id",""))')
if [ -n "$zone" ]; then
  curl -sS -X POST -H "Authorization: Bearer $purge_token" -H 'Content-Type: application/json' \
    --data "{\"files\":[\"$HOST/panel.js\",\"$HOST/consulta\",\"$HOST/patient.html\"]}" \
    "$api/zones/$zone/purge_cache" >/dev/null && echo "purged" ||
    echo "purge refused — the 60s TTL still propagates it"
else
  echo "zone not visible to this token; skipping the purge (60s TTL still applies)"
fi

echo "── smoke ──────────────────────────────────────────────"
size=$(curl -s -o /dev/null -w '%{size_download}' --max-time 20 -H 'Cache-Control: no-cache' \
  "$HOST/panel.js?smoke=$(git rev-parse --short HEAD)")
echo "panel.js -> $size bytes"
test "$size" -gt 100000
for path in consulta patient.html; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HOST/$path")
  echo "$path -> $code"
  test "$code" = 200
done
echo "✅ deployed the panel + the patient page"
