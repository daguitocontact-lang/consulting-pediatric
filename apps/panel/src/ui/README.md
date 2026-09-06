# `src/ui` — vendored from Daguito

Everything in this folder is a **copy** of `packages/ui/src/` in the Daguito
repo: design tokens, themes, fonts and the components the panel uses (`Badge`,
`Button`, `Card`, `DataTable`, `EmptyState`, `Input`, `Modal`, `Spinner`).

`@daguito/ui` is `"private": true` and ships unbuilt TypeScript with
workspace-only dependencies, so it cannot be installed from this repo. The folder
layout mirrors the core's exactly — `components/`, `lib/`, `hooks/` — so the
copies compile with their own relative imports and the sync is a plain file copy.

**Do not edit anything here.** Change it in the core and run:

```bash
DAGUITO_REPO=~/path/to/daguito ./scripts/sync-ui.sh
```

Pages never import from this folder directly; they import from
`src/components/ui.ts`, which is the single seam to rewrite the day
`@daguito/ui` is published.
