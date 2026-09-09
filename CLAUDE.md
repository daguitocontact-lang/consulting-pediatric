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

La pantalla de consulta es un **dock**, no una grilla fija (`lib/panel-layout.ts`
+ `components/consultation/Dock.tsx`). El legacy usa flexlayout-react con casi
todo en su default — solo apaga cerrar y renombrar (`tabEnableClose: false`,
`tabEnableRename: false`) — así que lo que deja PRENDIDO es lo que importa:
`tabEnableDrag`. Ahí el médico no intercambia paneles enteros, **arrastra una
pestaña de un grupo a otro**. Son cinco pestañas (reunión, asistente,
transcripción, recomendaciones, nota) en cuatro grupos; un grupo puede tenerlas
todas y uno que se queda sin ninguna desaparece y le cede el espacio al vecino.
Los tres bordes redimensionan, en PORCENTAJES y no en píxeles (el panel va
embebido con el ancho que le dé la página del host), con mínimo de 15 % — el asa
para reabrir un panel es el borde que desaparecería. Se guarda en `localStorage`,
por navegador: es una preferencia sobre una pantalla, no vale una columna y una
migración. Sin librería: es un arreglo de arreglos y tres números, y cada regla
es una función pura testeada (`tests/panel-layout.test.ts`).

El panel tiene dos secciones en el menú: **Consultas** y **Plantillas** (la
estructura de la nota, con `[[huecos]]`). `home` sigue existiendo y sigue
montando, pero está fuera de `SECTIONS` — es la página de ejemplo de la
plantilla y no tiene nada todavía; volver a ponerla es una línea. Una página sin
pestaña ensancha el union en `entry.tsx` (`NavSectionId | 'home'`), que es el
patrón que ese archivo documenta.

**Hoy el panel solo ofrece VIDEO al crear** (`OFFERED_MODES` en
`lib/consultations.ts`). Es una decisión del cliente, no un límite: los otros dos
modos están hechos y andan de punta a punta, la API sigue aceptando los tres, el
CHECK de la columna sigue permitiendo los tres, y una consulta ya creada en otro
modo abre y funciona igual. Volver a prender uno es agregarlo a ESE arreglo y
nada más — sacarlos de la API habría convertido eso en una migración. Con un solo
modo ofrecido el selector del formulario y la barra de pestañas desaparecen
solos: una pregunta con una sola respuesta y un filtro con una sola opción.

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

| modo | flow (slug) | cómo entra el audio |
| --- | --- | --- |
| `video` | `realtime-consultation` | mic del navegador → `<session>:doctor` (+ `:patient`) |
| `in_person` | `in-person-consultation` | mic del navegador → `<session>:doctor`, con diarización |
| `transcription` | `pre-recorded-consultation` | **archivo subido**, corrido por la API |

**`transcription` NO se transmite.** Su grafo tiene un solo nodo `s_stt_file`
que lee `audio_url` / `audio_base64` — no hay `a_transcribe_stream`, así que
mandarle micrófono abre un socket que nadie escucha y graba una hora de nada.
`flowForMode('transcription')` devuelve `null` a propósito y `/stream/token`
contesta 409. La subida va a `POST /api/consultations/:id/audio` (R2 privado,
whitelist de MIME, 200 MB) y `src/lib/prerecorded.ts` corre el flow del lado
servidor — desprendido, igual que el `PrerecordedTranscriptionService` del
legacy: el médico sube y cierra la pestaña. Un fallo queda en
`consultations.transcription_error` y el estado vuelve a `initial`, no se queda
en `processing` para siempre; `POST …/audio/retry` reintenta sin volver a subir.

`POST /api/consultations/:id/stream/token` (`src/lib/daguito-stream.ts`) hace lo
mismo que el backend Go del legacy: resuelve el webhook del flow por slug
(`GET /api/sdk/flows?slug=…` con `DAGUITO_STREAM_API_KEY`), abre la sesión
(`POST /v1/webhooks/:id/stream/open`) y acuña un token de rol `bidi` con TTL de
**6 horas** (el `streamTokenTTLSeconds` del legacy: el token tiene que sobrevivir
a la consulta; a una hora se vencía a mitad de una primera visita y la
transcripción se cortaba sin error en ninguna parte). **La llave nunca sale de la
API**: el panel recibe un token para UNA sesión.

**El `base_input` lo arma la API, no el navegador** (`src/consultations/flow-input.ts`):
`language`, `doctor_name` (del claim `name` del token), `patient_name`,
`template_body` y `model`. `template_body` es el que importa: es el markdown de
la plantilla, con `[[descripción]]` en cada hueco, y `c_soap` rellena ESE
documento — el resto del texto vuelve tal cual. Sin él la plantilla es una
etiqueta y el motor escribe su SOAP genérico. Se edita en la sección
**Plantillas** del panel; el schema que Daguito infiere de los `[[…]]` se cachea
en `consultation_templates.schema` (es una llamada a un LLM).

El `session_key` es el id de la consulta, así que un segundo médico que abra la
misma pantalla entra a la misma sesión en vez de arrancar otra transcripción.

**La sala es un Jitsi propio, no el público.** `JITSI_DOMAIN=meet.midulabs.com`
— el mismo servidor del legacy, y anónimo: el `.env` de midulabs no tiene NINGUNA
variable `JITSI_`, así que entra sin token, y nuestro `lib/jitsi.ts` hace lo
mismo cuando no hay `JITSI_APP_ID`/`SECRET`. Por eso el nombre de sala es
aleatorio (migración 0004) y no se deriva del id de la consulta: en un servidor
abierto, el nombre ES la llave.

Dejarlo vacío cae a `meet.jit.si`, y ahí la consulta **no abre**: el público solo
reconoce como moderador a una cuenta de 8x8, así que mete al médico en la sala de
espera con "The conference has not yet started because no moderators have yet
arrived" y nunca arranca. No existe `VITE_JITSI_DOMAIN`: el panel recibe dominio
y token de la API en runtime (el bundle corre dentro de la página de Daguito y no
se puede rebuildear para apuntar a otro Jitsi).

**El paciente tiene su propio canal, y su propia página.** `realtime-consultation`
transcribe DOS canales: `s_stt_doctor` en `<session>:doctor` y `s_stt_patient` en
`<session>:patient`. El navegador del médico alimenta el primero; el segundo lo
alimenta el navegador del PACIENTE — si nadie lo hace, ese nodo no falla, se
muere de hambre sus 30 s de timeout y el merge retiene también la transcripción
del médico. `POST /api/consultations/:id/patient-link` (solo video) acuña un JWT
HS256 y devuelve `…/consulta#c=<id>&t=<token>` — el token va en el FRAGMENTO,
que no se manda al servidor ni viaja en `Referer`. Dónde vive esa página es
configuración: ver `PATIENT_BASE_URL` abajo.

`GET /public/consultations/:id/patient/session` es la ÚNICA ruta además del
webhook que no pasa por `authorize()`: quien llama es un papá con un link, sin
cuenta de Daguito. Lo que el link compra es exactamente dos cosas — la sala como
NO moderador, y un token de stream de rol **`produce`**: empuja audio y no puede
leer el canal, donde viajan las recomendaciones y la nota. (El legacy acuña
`bidi` para su paciente porque su paciente es un usuario logueado del producto;
el nuestro no lo es.) Va con `open: false`: el flow ya lo abrió el médico.

El secreto de firma vive en `app_meta`, no en SSM: no significa nada fuera de
esta base, todas las tareas leen el mismo (un link sobrevive a un deploy
rodante) y así la función anda en un entorno nuevo sin una variable más que
alguien olvide poner. Por defecto la página (`apps/panel/public/patient.html`)
se sirve DESDE EL BUCKET DEL PANEL, al lado de `panel.js`, así que el
`import('./panel.js')` es del mismo origen y no necesita CORS; la API agrega
sola el origen del panel a su allow-list (`PANEL_BASE_URL` mueve las dos cosas a
la vez).

**El link es a una RUTA, no a un archivo.** `deploy-panel.yml` sube los mismos
bytes con DOS keys: `consulta` (sin extensión, con `Content-Type: text/html`) —
que es a la que apunta la API — y `patient.html`, que se queda porque los links
ya acuñados viven 12 h y porque es el path que sirve Vite desde `public/`. Un
`.html` en un link que el consultorio manda por WhatsApp parece algo que se
escapó de un servidor. En dev el `/consulta` lo reescribe el middleware de
`vite.config.ts`, para que el link que acuña la API no sea lo único que cambia
entre dev y prod. Al desplegar, el orden importa: primero `apps/panel/RELEASE`
(publica `consulta`), después el de la API.

**`PATIENT_BASE_URL` la saca de ahí y la pone bajo el dominio de Daguito.**
Es la URL COMPLETA de la página como Daguito la expone (p. ej.
`https://app.daguito.com/consulta`): el papá abre un link del producto y no un
hostname de bucket que nunca vio. Al ponerla, el enlace pasa a ser
`<PATIENT_BASE_URL>#c=<id>&t=<token>&api=…&panel=…` y ese origen entra solo en
la allow-list de CORS — las dos cosas salen del mismo lugar
(`src/lib/panel-origin.ts`), que es lo que impide que el link apunte a un host y
el CORS permita otro.

Puede llevar **`{id}`** si la ruta de Daguito ES la consulta
(`https://app.daguito.com/consulta/{id}`), que es la forma que tiene una ruta de
SPA. Ojo con el precio: ahí el id pasa por el path y queda en el log de acceso
de Daguito, que es exactamente lo que el fragmento evita. Sin `{id}` el id viaja
solo en el fragmento — la visita de un paciente no es una línea en el log de
nadie — y la página lo lee de ahí en las dos formas.

`api` y `panel` viajan en el fragmento porque en `app.daguito.com` la página ya
no puede deducir ninguno de los dos de su propio hostname (`api` salía de
cambiarle una etiqueta al host, y `./panel.js` de estar al lado del bundle). Son
públicos, pero un valor en una URL lo edita quien la tiene, así que la página
IGNORA cualquiera que no sea `https://…daguito.com` (o localhost, para el dev en
docker) y cae al default: un link reenviado no se puede reescribir para mandar
su token a otro servidor. `api` lo saca la API del `Host` del request que acuña
el link — cloudflared pasa el original — y `API_BASE_URL` lo fuerza si algún
proxy lo reescribe.

**Lo que tiene que poner Daguito** (no está en este repo), en una de dos formas:

1. **Proxy** de `…/consulta*` al bucket del panel (la key `consulta` y
   `panel.js` por el mismo prefijo). Nuestra página corre bajo su dominio y el
   import sigue siendo mismo-origen: no cambia nada de este lado.
2. **Página propia** que importe nuestro bundle y llame a `mountPatient(el,
   { apiBase, consultationId, token, locale })` — el mismo contrato que usa
   `patient.html`, exportado desde `panel.js` (`src/entry.tsx`). El import es
   cross-origin y el CORS del bucket ya permite exactamente `app.daguito.com`
   (`modules/r2-panel`).

En las dos, la ruta va SIN sesión de Daguito: quien la abre es un papá con un
link, no un usuario logueado.

**El audio va al sub-canal del doctor.** El grafo declara
`audio_session_suffix: "doctor"`, así que el nodo STT escucha en
`<session>:doctor` y NUNCA en la sesión pelada. Mandarlo al key pelado falla del
peor modo posible: el socket abre, el medidor de nivel se mueve, el flow dice
`ready` y no llega ni una palabra. Medido: 30 s de voz, cero eventos.

La salida se lee con `OutputStream` (`src/lib/useConsultationStream.ts`): el nodo
`c_facts` emite recomendaciones y CUALQUIER otro nodo `collect_data` la nota
(así lo despacha el legacy, para que un flow que renombre `c_soap` siga
llenándola). `node.token` son los parciales en vivo: se muestran en gris y NO se
guardan — un parcial se reescribe mientras el hablante sigue hablando. Los
eventos `cost` solo los ve la pestaña que consume el flow, así que se acumulan
ahí y se mandan a `POST …/costs` al detener; si no, el total se evapora al
cerrar, que es lo que le pasa al legacy. `lib/flow-transform.ts` es un port fiel
de su `services/daguito/transform.ts`, incluido `resolveSpeaker`: un canal de
diarización (`A`/`B`) NO es un rol y no se adivina — se guarda como `speaker_a`,
y solo `UNKNOWN` en presencial se atribuye al médico. Todo lo que llega se
persiste por NUESTRAS rutas (`/transcript`, `/recommendations`, `/note` con
`source: 'engine'`), así que el registro queda en la DB del custom y no en un
websocket que terminó.

El micrófono pasa por un **mezclador** (`AudioContext` → `GainNode` →
`MediaStreamDestination`) antes del `MicStream`, como en el legacy: es lo que
hace funcionar el mute (`track.enabled` no viaja por un grafo de Web Audio) y
`getUserMedia` va con `echoCancellation` / `noiseSuppression` / `autoGainControl`.
El VAD está **encendido**: en silencio el segmento STT pausa y la corrida alcanza
su deadline y cierra en vez de colgarse en `running` — el medidor de nivel del
header es lo que hace visible el caso en que el umbral no se cruza nunca.
El modo NUNCA se adivina: si la consulta todavía no cargó, no se arranca —
mandar una presencial por el flow de video deja el nodo `:patient` ocioso y el
merge retiene la transcripción del médico los 30 s del timeout.

**El asistente del chat es otro flow de la misma cuenta**: `consultation-chatbot`
(el "Dr. Midulabs" del legacy). `POST /api/consultations/:id/chat` guarda el
mensaje del médico, corre UN turno del agente (`runWebhookStream`, session key
`chatbot:<id>` — nunca el id pelado, o Daguito mete la transcripción en vivo
dentro de la burbuja del chat) y guarda la respuesta. La respuesta viene en el
TRAZO de la corrida: `output.steps[].data.output.content`, no en un campo
`reply`. Las claves de `context` deben coincidir con los `{{placeholders}}` del
prompt del flow: el agente interpola plano, y una clave renombrada renderiza
vacío y el asistente dice que no hay nota cuando sí la hay.

Sin `DAGUITO_STREAM_API_KEY` la ruta responde **503** y la pantalla lo dice
("Sin motor de transcripción"): sala, nota a mano y hilo del asistente siguen
funcionando.

## Releases — el archivo `RELEASE` es el trigger (igual que Daguito)

| Workflow | Trigger |
| --- | --- |
| `deploy-api.yml` | `apps/api/RELEASE` (build api → ECR → roll ECS; la imagen NO lleva el panel) |
| `deploy-panel.yml` | `apps/panel/RELEASE` (build `panel.js` → R2 `pediatric-panel`) |

Receta: bump `package.json` → bump `RELEASE` → commit+push a `main`. Sin bump, no deploy.
El orden importa: **primero el panel**, que es quien publica la key `consulta` a
la que la API le manda los links del paciente; una API que sale antes acuña
links que dan 404 hasta que el panel aterrice.

Manual, cuando CI no es opción: `./scripts/deploy.sh` (API, build ARM nativo) y
`./scripts/deploy-panel.sh` (panel + página del paciente en R2, con purge y
smoke). El segundo necesita `CLOUDFLARE_API_TOKEN` con R2 Object Read & Write —
exportado o en `infra/.env`.

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
