# Pediatric — custom de Daguito

Micro independiente que Daguito embebe: **API** (Elysia + Bun) + **panel
micro-frontend** (Vite → un `panel.js` en R2) + **funciones de agente**, con su
propia base de datos y su propia infra.

Generado con `daguito-custom-template/bootstrap.sh pediatric`. Trae la
plataforma completa —
autenticación con el token de Daguito, allow-list de orgs, status, registro de
campos del contacto, receptor de webhooks, almacenamiento en R2, panel con el
sistema de diseño del core, Terraform y CI— y **ningún dominio**: eso se escribe
encima. Las reglas de trabajo están en `CLAUDE.md`.

## Correr en local

```bash
cp infra/.env.example infra/.env                 # una vez; edítalo
docker compose -f infra/docker-compose.dev.yml up -d
cd apps/api && bun scripts/dev/mint-token.ts     # token RS256 de dev
```

- API: <http://localhost:4101/health>
- Panel (dev harness): <http://localhost:4102>

Para que Daguito lo alcance por HTTPS real:

```bash
./scripts/dev/setup-tunnels.sh <tu-usuario>   # crea túneles + DNS (idempotente)
./scripts/dev/tunnel.sh
```

## Puesta en prod, la primera vez

1. **`prod.tfvars`** — `cp infra/terraform/envs/prod/prod.tfvars.example
   infra/terraform/envs/prod/prod.tfvars` y llénalo: `daguito_org_ids` (la org
   real del cliente), `cloudflare_*`, `daguito_jwt_public_key` (SSM
   `/daguito/prod/api/AUTH_JWT_PUBLIC_KEY`), `github_repo`.
2. **`terraform apply`** — desde `infra/terraform/envs/prod`, con
   `CLOUDFLARE_API_TOKEN` exportado. Crea RDS, ECS, el túnel, los buckets R2, el
   role de CI y los parámetros de SSM.
3. **Secretos del repo en GitHub** — `AWS_DEPLOY_ROLE_ARN` (output de
   Terraform), `CLOUDFLARE_API_TOKEN` (R2), `CLOUDFLARE_PURGE_TOKEN`
   (Zone:Read + Cache Purge), `DISCORD_DEPLOY_WEBHOOK`.
4. **Daguito** — en la org del cliente, apunta el custom panel a
   `https://pediatric-panel.daguito.com/panel.js` y la API a
   `https://pediatric-api.daguito.com`.
5. **Deploy** — bump `apps/api/RELEASE` y `apps/panel/RELEASE`, push a `main`.

## Estructura

```
apps/api          Elysia + Bun. src/lib (auth, guard, db, migrate, storage),
                  src/daguito (salida), src/webhooks (entrada), src/agent
                  (tools). El dominio son módulos nuevos bajo src/.
apps/panel        Vite + React 19 + Tamagui. src/ui es @daguito/ui vendoreado
                  (sync-ui.sh, no editar), src/components son las piezas
                  compartidas, src/pages las páginas.
infra             docker-compose de dev + Terraform de prod.
scripts           deploy manual y túneles de dev.
```

Después de cualquier cambio: `bun run typecheck` en `apps/api` y `apps/panel`, y
`terraform validate` en `infra/terraform/envs/prod`.
