# Pediatric — Guidelines (custom de Daguito)

Micro independiente para **Pediatric**: API + panel micro-frontend +
funciones de agente, con su propia DB e IaC. Generado con
`daguito-custom-template/bootstrap.sh` — todo lo que hay aquí es la capa de
plataforma; el dominio de este cliente se escribe encima.

## Qué es este micro

- **Panel(es) micro-frontend** que Daguito embebe en su menú vía **Module Federation**.
  El remoto expone `./manifest` (lista de páginas con icono) + un módulo por página
  con contrato `{ mount(el, props), unmount(el) }` (framework-agnóstico).
- **Funciones de agente**: `GET /agent/functions` + `POST /agent/functions/:name` —
  tools que el agente de Daguito llama por HTTP y que **corren aquí**, leyendo la DB
  del custom (`src/agent/functions.ts`, hoy vacío).
- **Status**: `GET /api/status` lee la versión desde RDS (prueba web→api→db).

Todo va detrás de un **token RS256 firmado por Daguito** — se valida con la llave
pública `DAGUITO_JWT_PUBLIC_KEY` (audiencia `custom-panel`).

**El chequeo de `org_id` es obligatorio y ya está implementado.** Daguito firma
tokens `custom-panel` para **todas** sus orgs con la misma llave, así que la firma
sola NO prueba que quien llama sea nuestro cliente. `DAGUITO_ORG_IDS` (lista
separada por comas) es la allow-list de tenants; la API **no arranca** sin ella
(fail-closed, igual que `DATABASE_URL`). Toda ruta protegida pasa por
`requireOrg(request)` (`lib/guard.ts`, sobre `authorize` de `lib/auth.ts`) —
nunca por `verifyDaguitoToken` directo, para que un endpoint nuevo no pueda
olvidar el chequeo. 401 = token inválido, 403 = token válido de otra org.

**El token dura 5 minutos y el panel lo renueva solo** (`apps/panel/src/lib/session.ts`).
Daguito lo acuña con `ttlS: 300` y UNA sola vez por carga del host: sin renovar,
el panel abierto más de 5 minutos contesta 401 en todas sus llamadas a la vez.
Como el bundle CORRE en la página del host, el panel pide un token nuevo al mismo
endpoint que usó el host (`GET {api-daguito}/organizations/:orgId/custom-panel/token`,
con `credentials: 'include'`), antes de cada llamada y otra vez tras un 401. La
banda de «sesión vencida» quedó solo para cuando la RENOVACIÓN falla: ahí lo que
venció es la sesión de Daguito. No se llama nunca a `/v1/auth/refresh` de
Daguito: su refresh token rota y es de un solo uso.

## Stack

- **API**: Elysia + Bun (`apps/api`), solo JSON (`/health`, `/api/*`, `/agent/*`).
- **Panel**: Vite (`apps/panel`) → un solo `panel.js` ESM en R2 que Daguito importa en runtime.
- **DB**: RDS PostgreSQL `t4g.micro` (single-AZ).
- **Deploy**: ECS Fargate (Spot) + Cloudflare Tunnel (sin ALB/NAT nueva) —
  reusa la VPC/NAT/bastión de **Daguito**. API en `pediatric-api.daguito.com`; panel
  estático en R2 en `pediatric-panel.daguito.com/panel.js`.
- **IaC**: Terraform (`infra/terraform`), state en `daguito-tf-state-322056173639`
  key `customs/pediatric/prod.tfstate`.
- **Dev**: local (docker compose + Cloudflare Tunnels). **No hay entorno dev en AWS.**

## Cómo se agrega dominio

Un módulo de la API es una carpeta bajo `apps/api/src/<modulo>/` con
`routes/` + `repos/` y un `index.ts` que exporta una instancia de Elysia; se
monta con `.use(<modulo>Module)` en `src/index.ts`. **Cada handler empieza por
`requireOrg` y cada query filtra por `orgId`.** Las tablas van en
`migrations/0002_*.sql` en adelante (idempotentes).

Una sección del panel son tres ediciones: una línea en `SECTIONS`
(`src/manifest.ts`), un módulo en `src/pages/`, y su entrada en `PAGES`
(`src/entry.tsx`) — el tipo unión hace que falte una sea error de build. La copy
va siempre en `src/lib/i18n.ts`, en los dos idiomas.

## Dev local (docker compose + Cloudflare Tunnels)

Igual que Daguito: su Terraform es **solo prod** y el dev vive en Docker con
túneles de Cloudflare. Un custom no paga una segunda RDS/ECS para dev.

```bash
cp infra/.env.example infra/.env            # una vez
docker compose -f infra/docker-compose.dev.yml up -d
```

| Servicio | Puerto | Nota |
| --- | --- | --- |
| API (Elysia/Bun, `--watch`) | 4101 | migra la DB al arrancar, igual que en prod |
| Panel (Vite, HMR) | 4102 | sirve `/panel.js` (mismo path que R2 en prod) |
| Postgres 16 | 5442 | reemplaza a RDS; sin TLS → `DB_SSL=disable` |

Puertos en los 4100/5442 **a propósito**: el stack dev de Daguito usa 4000s/5433,
así corren los dos a la vez. Si vas a correr DOS customs a la vez, cámbialos en
`infra/.env`.

### Túneles (Daguito debe alcanzar el micro por HTTPS real)

Daguito importa el panel como módulo ESM **cross-origin** y el browser llama a la
API desde ese origen: ambos necesitan HTTPS en la zona `daguito.com`.

```bash
./scripts/dev/setup-tunnels.sh <tu-usuario>   # crea túneles + DNS (idempotente)
./scripts/dev/tunnel.sh                       # corre api + panel
```

Hostnames `pediatric-api-<user>.daguito.com` / `pediatric-panel-<user>.daguito.com` —
**dos niveles**, para que los cubra el certificado universal `*.daguito.com`
(prod también: `pediatric-api.daguito.com`, no `api.pediatric…`, que pediría
advanced cert). El slug sale de `PEDIATRIC_TUNNEL_USER` en `infra/.env`.

### Token en dev

No hay un Daguito local que firme tokens, así que el minter genera un par RS256
descartable en `infra/.dev-jwt/` (gitignored), escribe la pública en `infra/.env`
y emite un token:

```bash
cd apps/api && bun scripts/dev/mint-token.ts [orgId] [userId] [ttl]
```

**La verificación no se debilita**: sigue siendo RS256 real + audiencia
`custom-panel` + expiración, solo que contra una llave local. Para probar con los
tokens reales de Daguito, pon su llave pública en `infra/.env` y omite el minter.
`DAGUITO_JWT_PUBLIC_KEY` acepta PEM **o** base64 del PEM (un `.env` no lleva
saltos de línea).

`ALLOWED_ORIGIN` es lista separada por comas — en prod va **un** origen.

## Campos del contacto en el CRM de Daguito (salida, al arrancar)

Único punto donde este micro llama HACIA Daguito (`src/daguito`). Al bootear
registra en la org los campos que el formulario del cliente pide y el CRM no
tiene columna para. `email`/`phone`/`name` son nativos y por eso NO se registran;
ojo con `contacts.address`, que en Daguito es la dirección de CANAL (el número de
WhatsApp), no la postal.

`CONTACT_FIELDS` (`src/daguito/lib/contact-fields.ts`) **viene vacío**: se llena
con los campos de este cliente. Es idempotente por `key` (Daguito la deriva del
label): un segundo boot no escribe nada, y un campo que el operador editó se
queda como está — solo se reporta la diferencia en el log. Renombrar un label
crea un campo NUEVO; el valor viejo queda bajo la key vieja.

La credencial es una **account key** de Daguito (`dgsk_acc_…`, atada a UNA org y
revocable desde ahí): `DAGUITO_API_BASE` + `DAGUITO_API_KEY`. Sin esas variables
el registro se salta y la API arranca igual (no es fail-closed: no protege datos).

## Archivos privados (R2 privado)

`lib/storage.ts` guarda bytes en un bucket R2 **privado** (`pediatric-docs`, sin
dominio público ni CORS) y **solo la API** lo toca. Guarda siempre la **key**,
nunca una URL: una key filtrada no sirve de nada. El panel sube multipart y para
ver el archivo lo baja con el token y arma un blob URL (un `<img src>` no puede
llevar `Authorization`).

Sin `R2_*` (dev) el mismo módulo escribe en `STORAGE_DIR` (`apps/api/.storage/`,
gitignored). No es fail-closed: si falta el bucket en prod la API arranca igual y
solo se degradan los archivos. Las credenciales (token R2 con Object Read &
Write) se crean **a mano** en el dashboard de Cloudflare y entran por
`r2_access_key_id` / `r2_secret_access_key` en `prod.tfvars` → SSM SecureString
`/pediatric/prod/api/R2_*`.

## Webhooks de Daguito (entrada)

`POST /webhooks/daguito/events` (`src/webhooks`) es la única ruta que NO pasa por
`authorize()`: quien llama es el worker de Daguito, sin token de panel ni sesión.
En su lugar valida el HMAC sobre el **cuerpo crudo** (`parse: 'text'`, si se
re-serializa el JSON se re-escapan los acentos y la firma no cuadra) con
`DAGUITO_WEBHOOK_SECRET`, y además exige que `org_id` esté en `DAGUITO_ORG_IDS`.

Todo lo que no sea el evento que interesa responde 200 e ignora: un 4xx solo
compraría cinco reintentos idénticos. Lo que el handler CREE tiene que ser
idempotente por el id del evento (columna + índice único parcial), porque los
reintentos son cinco entregas del mismo evento. La suscripción vive en el repo de
Daguito (una migración que la inserta apuntando a esta url).

## El motor de la consulta: flows de Daguito

La IA de la consulta NO vive en este repo. Son **flows de Daguito**, los mismos
que publica el producto legacy (midulabs) y en **la misma cuenta**:

| modo | flow (slug) |
| --- | --- |
| `video` | `realtime-consultation` |
| `in_person` | `in-person-consultation` |
| `transcription` | `pre-recorded-consultation` |

`POST /api/consultations/:id/stream/token` (`src/lib/daguito-stream.ts`) hace lo
mismo que el backend Go del legacy: resuelve el webhook del flow por slug
(`GET /api/sdk/flows?slug=…` con `DAGUITO_STREAM_API_KEY`), abre la sesión
(`POST /v1/webhooks/:id/stream/open`) y acuña un token corto de rol `bidi`
(`POST /v1/webhooks/:id/stream-tokens`). **La llave nunca sale de la API**: el
panel recibe un token para UNA sesión.

El `session_key` es el id de la consulta, así que un segundo médico que abra la
misma pantalla entra a la misma sesión en vez de arrancar otra transcripción.

**El audio va al sub-canal del doctor.** El grafo declara
`audio_session_suffix: "doctor"`, así que el nodo STT escucha en
`<session>:doctor` y NUNCA en la sesión pelada. Mandarlo al key pelado falla del
peor modo posible: el socket abre, el medidor de nivel se mueve, el flow dice
`ready` y no llega ni una palabra. Medido: 30 s de voz, cero eventos.

La salida se lee con `OutputStream` (`src/lib/useConsultationStream.ts`): el nodo
`c_facts` emite recomendaciones y `c_soap` la nota, con el mismo
`collect_data.streaming_update` que el legacy — por eso `lib/flow-transform.ts`
es un port fiel de su `services/daguito/transform.ts`. Todo lo que llega se
persiste por NUESTRAS rutas (`/transcript`, `/recommendations`, `/note` con
`source: 'engine'`), así que el registro queda en la DB del custom y no en un
websocket que terminó.

Sin `DAGUITO_STREAM_API_KEY` la ruta responde **503** y la pantalla lo dice
("Sin motor de transcripción"): sala, nota a mano y hilo del asistente siguen
funcionando.

## Releases — el archivo `RELEASE` es el trigger (igual que Daguito)

| Workflow | Trigger |
| --- | --- |
| `deploy-api.yml` | `apps/api/RELEASE` (build api → ECR → roll ECS; la imagen NO lleva el panel) |
| `deploy-panel.yml` | `apps/panel/RELEASE` (build `panel.js` → R2 `pediatric-panel`) |

Receta: bump `package.json` → bump `RELEASE` → commit+push a `main`. Sin bump, no deploy.
Manual: `./scripts/deploy.sh` (build ARM nativo).

**El panel se propaga solo.** Daguito importa UNA url (`…/panel.js`), así que no
hay nombre con hash que hacer inmutable: la frescura la dan dos piezas que van
juntas — el `Cache-Control: max-age=60` que pone el upload + la **cache rule** del
módulo `r2-panel` (sin ella la zona impone su default de 4h a navegador Y edge) —
y el **purge** que hace `deploy-panel.yml` al terminar. Si un release no aparece,
revisa esa regla antes que nada.

Infra: **no hay workflow** — `terraform apply` es local, con
`CLOUDFLARE_API_TOKEN` exportado y `prod.tfvars` (gitignored) completo. El role de
CI `pediatric-prod-ci-deploy` (secret `AWS_DEPLOY_ROLE_ARN`) lo gestiona
`modules/github-oidc`. Sin binario local, `terraform validate` corre con
`docker run --rm -v "$PWD/infra/terraform:/tf" -w /tf/envs/prod --entrypoint sh
hashicorp/terraform:1.15 -c 'terraform init -backend=false && terraform validate'`.

## Organización AWS (para N customs)

- Nombres `{client}-{env}-*` (`pediatric-prod-db`, `pediatric-prod-api`, cluster `pediatric-prod`…).
- `default_tags` en todo: `Project=daguito, Client=pediatric, Env=prod, ManagedBy=terraform`.
- `aws_resourcegroups_group pediatric-prod` (tag `Client`) → todos los recursos del cliente juntos.
- Cost Allocation Tag `Client` → costo por cliente en Billing. Costo ≈ **$18/mes** (ver `COST.md`).

## Reglas de código

- English para código/identificadores/commits. Copy de UI localizable (`lib/i18n.ts`).
- Prettier (line 100, singleQuote, semi:false). No hay `.prettierrc`: pasa
  `--print-width 100 --single-quote --no-semi` a mano.
- Zero CSS suelto en el panel salvo lo mínimo del micro.
- Secretos: nunca en el repo. SSM `/pediatric/prod/api/*` (DATABASE_URL,
  DAGUITO_JWT_PUBLIC_KEY, DAGUITO_API_KEY), `/pediatric/prod/tunnel-token`. IaC los crea/lee.
- Migraciones idempotentes en `migrations/NNNN_*.sql`, aplicadas al bootear la API.

## Panel: React + Tamagui con el sistema de Daguito

El panel usa **React 19 + Tamagui**, no vanilla: son los mismos componentes del
core. Como `@daguito/ui` es `private` y sin build, se **vendorean**:

- `src/ui/{tokens,themes,fonts,animations}.ts` — copia de `packages/ui/src/`.
- `src/ui/components/*.tsx` — `Badge`, `Button`, `Card`, `DataTable`,
  `EmptyState`, `Input`, `Modal`, `Spinner`, copiados tal cual del core.
- `scripts/sync-ui.sh` los refresca (`DAGUITO_REPO=... ./scripts/sync-ui.sh`).

**No editar esos archivos aquí**: se cambian en Daguito y se re-sincronizan. Las
páginas importan siempre desde `../components/ui`, así el día que se publique
`@daguito/ui` solo cambia ese barrel.

El host NO comparte React con el remoto (`mount(el, props)` recibe un `<div>` y
nada más), así que el panel trae su propia instancia y su `TamaguiProvider`. Eso
cuesta ~227 kB gzip; si algún día Daguito expone React/Tamagui por import map,
se declaran `external` en `vite.config.ts` y el bundle vuelve a ~25 kB.

## Mandatory final step

Tras cualquier cambio: `bun run typecheck` en `apps/api` y `apps/panel`, y
`terraform validate` en `infra/terraform/envs/prod` (vía docker si no hay
binario, ver Releases). `main` siempre desplegable.
