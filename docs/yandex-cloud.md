# Yandex Cloud deployment

This document describes how to deploy the Bitrix24 Expo Calendar app to
**Yandex Cloud Serverless Containers**, fronted by **Yandex Container
Registry**.

The current production deployment lives on Render
(`https://calendar-interpro-app.onrender.com`). The Render setup remains the
canonical deploy until the cut-over described in
[§ Cut-over from Render](#cut-over-from-render).

> No CRM data is migrated or rewritten by this process. Bitrix24 placements
> are only touched once, at cut-over, to point at the new public URL.

---

## 1. Prerequisites

You need (one-time):

- A Yandex Cloud **folder** with billing enabled.
- The `yc` CLI installed locally and `yc init` completed.
  <https://yandex.cloud/en/docs/cli/quickstart>
- A **service account** with these roles inside the target folder:
  - `container-registry.images.puller` (Serverless Container pulls images)
  - `container-registry.images.pusher` (used by `yc` / GitHub Actions to push)
  - `serverless.containers.invoker` (only if you want IAM-protected calls)
  - `serverless.containers.editor` (to revise the container)
- Docker (or `yc container image push`) on the machine that builds images.

Save these in your shell session (replace placeholders, **do not commit**):

```bash
export YC_FOLDER_ID=<folder id>
export YC_REGISTRY_ID=<registry id>             # created in step 2
export YC_CONTAINER_NAME=bitrix-expo-app
export YC_REGION=ru-central1
export IMAGE_TAG=$(git rev-parse --short HEAD)
export IMAGE_URI="cr.yandex/${YC_REGISTRY_ID}/${YC_CONTAINER_NAME}:${IMAGE_TAG}"
```

---

## 2. Container Registry

```bash
yc container registry create --name bitrix-expo-app-registry
# capture the id → set YC_REGISTRY_ID
yc container registry list
```

Authenticate Docker to push to Yandex CR (one of):

```bash
# OAuth flow (interactive)
yc container registry configure-docker

# OR service-account key file (CI)
cat key.json | docker login --username json_key --password-stdin cr.yandex
```

---

## 3. Build & push the image

The project ships a multi-stage `Dockerfile` at the repo root. It runs
`npm run check && npm test && npm run build` inside the builder stage, then
copies only the bundled server, the built client assets and the production
`node_modules` into a slim runtime image that runs as a non-root user.

```bash
docker build -t "${IMAGE_URI}" .
docker push      "${IMAGE_URI}"
```

For multi-arch builds (Yandex Serverless Containers runs `linux/amd64`):

```bash
docker buildx build --platform linux/amd64 -t "${IMAGE_URI}" --push .
```

---

## 4. Create the Serverless Container

```bash
yc serverless container create --name "${YC_CONTAINER_NAME}"
```

Pick conservative defaults for the first revision:

| setting        | value                              | rationale                                    |
| -------------- | ---------------------------------- | -------------------------------------------- |
| memory         | `512MB` (bump to 1GB if cold-slow) | Node + better-sqlite3 fits comfortably       |
| cores          | `1`                                | single-threaded Node event loop              |
| timeout        | `60s`                              | Bitrix REST calls + parsing                  |
| concurrency    | `8`                                | Express handles N concurrent requests fine   |
| execution-mode | `concurrent`                       | required for HTTP servers                    |
| service-account| the one created above              | needed to pull from CR                       |

---

## 5. Deploy a revision

```bash
yc serverless container revision deploy \
  --container-name "${YC_CONTAINER_NAME}" \
  --image          "${IMAGE_URI}" \
  --cores 1 \
  --memory 512MB \
  --concurrency 8 \
  --execution-timeout 60s \
  --service-account-id "${YC_SA_ID}" \
  --environment NODE_ENV=production \
  --environment BITRIX_PORTAL=b24-5syfa7.bitrix24.ru \
  --environment BITRIX_UF_ENTITY_ID=CRM_8 \
  --environment APP_BASE_URL=https://<container-id>.containers.yandexcloud.net \
  --environment PARSE_RATE_LIMIT_MS=1000 \
  --environment CRON_REPORT_CHANNEL=personal \
  --environment OWNER_USER_ID=1
```

Then set the **secret** env vars from the Yandex Cloud console
(`Serverless Containers → <container> → Edit revision → Environment
variables`). Do **not** put real secrets on the CLI history or in a file
under version control.

Secrets to add manually (matches the keys in `.env.example`):

- `BITRIX_WEBHOOK_URL` — full inbound webhook URL
- `ADMIN_JOB_TOKEN`    — random long string (`openssl rand -hex 32`)
- `CRON_REPORT_CHAT_ID` — only if `CRON_REPORT_CHANNEL=chat`

> **Tip.** For tighter secret hygiene, store these in **Yandex Lockbox**
> and bind them to the container via
> `--secret environment-variable=BITRIX_WEBHOOK_URL,id=<lockbox-id>,version-id=<v>,key=webhook`
> instead of passing them in the revision env directly.

---

## 6. Make it public & verify

```bash
# allow unauthenticated invocation (public web app)
yc serverless container allow-unauthenticated-invoke "${YC_CONTAINER_NAME}"

# print the public URL
yc serverless container get "${YC_CONTAINER_NAME}" --format json \
  | jq -r .url
```

Health check:

```bash
curl -fsS "$(yc serverless container get "${YC_CONTAINER_NAME}" --format json \
  | jq -r .url)/health"
# → {"ok":true,"app":"bitrix-expo-app"}
```

The server listens on `process.env.PORT` (Yandex injects this — typically
`8080`) and binds `0.0.0.0`, so no extra configuration is needed.

---

## 7. Update `APP_BASE_URL` once the URL is known

The very first revision uses a placeholder for `APP_BASE_URL`. After step 6
gives you the actual `https://<id>.containers.yandexcloud.net` URL:

1. Edit the revision and set `APP_BASE_URL` to that value.
2. Re-deploy (Serverless Containers always creates a new revision).

If you map a custom domain in Yandex Cloud (e.g. `calendar.interpro.ru`),
use that as `APP_BASE_URL` instead.

---

## 8. Cut-over from Render

Only do this once steps 1–7 are green:

1. In Bitrix24 admin → **Applications → Local applications**, update the
   handler URL (the `APP_BASE_URL` echoed in placement registrations) to
   the Yandex Cloud URL.
2. Re-run the placement-binding migration **only if a placement handler URL
   actually changed**:

   ```bash
   # one-off, from a trusted machine with BITRIX_WEBHOOK_URL exported
   npm run bind-placements
   ```

3. Smoke-test the placements inside Bitrix24 (open a smart-process item, hit
   the embedded UI, verify the admin "Fill source URLs" button works).
4. Suspend the Render web service and the Render cron job. Do **not** delete
   them until the new deploy has been stable for ≥ 1 week.

---

## 9. Weekly cron job

Render hosts a separate cron service (see `render.yaml`). On Yandex Cloud
the equivalent is **Cloud Functions + Trigger** (a "timer" trigger), or a
separate Serverless Container revision invoked by a timer trigger.

Cheapest path is a Function that simply HTTP-POSTs to a protected endpoint
on the main container. Since this code currently exposes the cron as a CLI
entry (`server/cron/weekly-check.ts`), the simplest production option is:

- Wrap the cron logic behind an HTTP endpoint (future work — not in scope
  for this migration), **or**
- Keep the cron on Render until a follow-up PR adds an HTTP entrypoint, then
  configure a Yandex Cloud **Timer** trigger (`0 6 * * 1`) pointing at it.

Either way, the cron job needs the same secrets as the main service.

---

## Required env vars (summary)

Non-secret (can live in revision config or `render.yaml`-style file):

| key                  | example                                      |
| -------------------- | -------------------------------------------- |
| `NODE_ENV`           | `production`                                 |
| `BITRIX_PORTAL`      | `b24-5syfa7.bitrix24.ru`                     |
| `BITRIX_UF_ENTITY_ID`| `CRM_8`                                      |
| `APP_BASE_URL`       | `https://<id>.containers.yandexcloud.net`    |
| `PARSE_RATE_LIMIT_MS`| `1000`                                       |
| `OWNER_USER_ID`      | `1`                                          |
| `CRON_REPORT_CHANNEL`| `personal`                                   |

Secret (set manually in console / Lockbox; **never** commit):

| key                   | source                                  |
| --------------------- | --------------------------------------- |
| `BITRIX_WEBHOOK_URL`  | Bitrix24 → Developer resources → Webhook|
| `ADMIN_JOB_TOKEN`     | `openssl rand -hex 32`                  |
| `CRON_REPORT_CHAT_ID` | only if `CRON_REPORT_CHANNEL=chat`      |

---

## GitHub Actions

A manual deploy workflow is included at
`.github/workflows/deploy-yandex.yml`. It is **gated on
`workflow_dispatch`** so it never runs on push and will not interfere with
the existing Render auto-deploy.

To enable it later, add these repository secrets:

- `YC_SA_JSON_CREDENTIALS` — service-account key JSON (from
  `yc iam key create --service-account-name <sa>`)
- `YC_REGISTRY_ID`        — Yandex Container Registry id
- `YC_CONTAINER_NAME`     — `bitrix-expo-app`
- `YC_SA_ID`              — service-account id used to run the container

The workflow only **builds, pushes and deploys an image**. Runtime secrets
(`BITRIX_WEBHOOK_URL`, `ADMIN_JOB_TOKEN`, …) stay in the Yandex Cloud
console — the workflow never reads or echoes them.

---

## Troubleshooting

- **502 / cold start timeouts** — bump revision memory to 1024MB; cold
  Node + Vite-built bundle takes ~1–2 s.
- **`/health` returns 503** — `ADMIN_JOB_TOKEN` is set but the inbound
  webhook is wrong; check container logs in the console.
- **`better-sqlite3` module load error** — image was built on a different
  glibc. Always build with the provided multi-stage `Dockerfile`, which
  uses `node:20-bookworm-slim` consistently.
- **Image too large** — confirm `.dockerignore` is being applied
  (`docker build` log should show "Sending build context to Docker daemon
  ~5–10MB", not hundreds of MB).
