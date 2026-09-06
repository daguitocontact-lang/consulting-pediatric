#!/usr/bin/env bash
# Re-copy Daguito's design system into this repo.
#
# `@daguito/ui` is `"private": true` and ships unbuilt TypeScript with
# workspace-only deps, so it cannot be installed from here. `src/ui/` mirrors
# `packages/ui/src/` exactly — same folder names, so the copies keep compiling
# with their own relative imports and this script stays a plain copy.
#
# Never hand-edit anything under src/ui/: change it in the core and re-run this.
# When @daguito/ui is published, delete this script and depend on the package.
set -euo pipefail

DAGUITO_REPO="${DAGUITO_REPO:-$HOME/Documents/job/daguito}"
SRC="$DAGUITO_REPO/packages/ui/src"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src/ui"

[ -d "$SRC" ] || { echo "No encuentro $SRC — exporta DAGUITO_REPO" >&2; exit 1; }

# Only what the panel actually uses: copying the whole package would drag in the
# core's contexts, flows and API clients, none of which exist here.
for file in tokens.ts themes.ts fonts.ts animations.ts; do
  cp "$SRC/$file" "$DEST/$file"
  echo "· $file"
done

for file in "$DEST"/components/*.tsx "$DEST"/lib/*.ts "$DEST"/hooks/*.ts; do
  rel="${file#"$DEST"/}"
  if [ -f "$SRC/$rel" ]; then
    cp "$SRC/$rel" "$file"
    echo "· $rel"
  else
    echo "! $rel ya no existe en el core" >&2
  fi
done

echo
echo "Listo. Revisa el diff y corre: bun run typecheck"
