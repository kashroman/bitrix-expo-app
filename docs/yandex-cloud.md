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

> **Heads-up.** Yandex Serverless Containers *replace* the entire env on
> every revision deploy. Every variable the app reads at runtime — both
> non-secret config and secrets — has to be passed in this single call.
> For the CI path, see [§ GitHub Actions](#github-actions); the workflow
> wires everything from GitHub Secrets/Variables for you.

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
  --environment OWNER_USER_ID=1 \
  --environment "BITRIX_WEBHOOK_URL=${BITRIX_WEBHOOK_URL}" \
  --environment "ADMIN_JOB_TOKEN=${ADMIN_JOB_TOKEN}"
  # add --environment "CRON_REPORT_CHAT_ID=${CRON_REPORT_CHAT_ID}" only
  # when CRON_REPORT_CHANNEL=chat
```

For manual one-off deploys, export the secret values into your shell
beforehand (`export BITRIX_WEBHOOK_URL=…`) so they never appear in your
shell history as literals. For tighter hygiene, store them in **Yandex
Lockbox** and bind via `--secret environment-variable=…` instead.

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
2. Re-bind the 7 managed placements to the Yandex Cloud URL. The script is
   safe-by-default (dry-run unless `--apply`), and `--cleanup-stale` will
   unbind handlers for the same managed routes whose host is **not** the
   current `APP_BASE_URL` host — typically the old Render handlers.

   The recommended path is the manual GitHub Actions workflow
   `.github/workflows/rebind-placements.yml` — it runs the same script on
   GitHub-hosted runners using the repo's `BITRIX_WEBHOOK_URL` secret and
   `APP_BASE_URL` variable, so no local shell or browser is needed:

   1. Go to **Actions → rebind-placements (manual) → Run workflow**.
   2. Leave `mode` on `dry-run` for the first run, and leave `app_base_url`
      empty to use `vars.APP_BASE_URL`. The `stale_base_url` input
      defaults to the previous Render URL
      (`https://calendar-interpro-app.onrender.com`) — leave it as-is for
      the Render → Yandex cut-over, or blank it out for portals that never
      ran on Render.
   3. Review the plan in the job log. With `stale_base_url` set, you'll see
      planned `UNBIND ... (fallback)` lines for the 7 managed placement +
      route pairs under the stale host, followed by the planned binds under
      `APP_BASE_URL`.
   4. Re-run with `mode = apply` once the plan looks right.

   **Why `stale_base_url`?** Some inbound webhooks don't expose
   `placement.get` / `placement.list`. When that happens, the script logs
   `cleanup-stale: placement.get/list unavailable via this webhook; skipping
   stale scan.` and the scan can't see the old handler to unbind it — which
   would leave the Render and Yandex handlers double-bound. Setting
   `stale_base_url` makes the script compute the exact handlers it *would
   have* generated under that base for the same 7 managed routes and call
   `placement.unbind` for each (tolerating "not found" responses), so the
   cut-over still works without `placement.list`.

   For local runs (only when needed):

   ```bash
   # 1) Preview the plan (no API writes). STALE_BASE_URL is optional —
   #    include it to also plan exact-handler unbinds for the old Render URL:
   APP_BASE_URL=https://bba8ln220jfloq5251dv.containers.yandexcloud.net \
   STALE_BASE_URL=https://calendar-interpro-app.onrender.com \
     npm run rebind-placements -- --dry-run

   # 2) Apply once the plan looks right:
   APP_BASE_URL=https://bba8ln220jfloq5251dv.containers.yandexcloud.net \
   STALE_BASE_URL=https://calendar-interpro-app.onrender.com \
     npm run rebind-placements -- --apply

   # Equivalent flag form (avoids exporting STALE_BASE_URL):
   npm run rebind-placements -- --apply \
     --stale-base-url=https://calendar-interpro-app.onrender.com
   ```

   Both commands require `BITRIX_WEBHOOK_URL` to be exported in the shell
   (don't paste it inline — it will land in shell history). The script only
   touches the 7 placement+route pairs it owns; any unrelated handlers are
   left intact. It logs counts and `host=…`/`path=…` per change — never the
   webhook URL.

3. Smoke-test the placements inside Bitrix24 (open a smart-process item, hit
   the embedded UI, verify the admin "Fill source URLs" button works).
4. Suspend the Render web service and the Render cron job. Do **not** delete
   them until the new deploy has been stable for ≥ 1 week.

---

## 8a. Long-running Source URL enrichment on serverless

The in-app **«Заполнение URL»** flow (`POST /api/admin/fill-source-urls/start`
+ polling GET) keeps a job map in **process memory**. On Yandex Serverless
Containers (and any host that may scale to multiple instances or scale to
zero) the POST that creates a job can land on one instance while a later
GET for status lands on a different / cold instance — the second instance
has no record of the job and returns `404`, even though the original job
is still running. The in-app async UI is therefore only reliable on
single-instance hosts (e.g. Render's web service) unless an external job
store (Redis / DB) is added.

**Recommended path on Yandex Cloud (and other serverless hosts):** run
the existing CLI from GitHub Actions, which gives the job a stable,
single-process host with no cold-start risk. A manual workflow is wired
up at `.github/workflows/fill-source-urls.yml`:

- Trigger: `workflow_dispatch` only (never on push).
- Inputs: `mode` (`dry-run` default / `apply`), `limit` (default `20`),
  optional `min_confidence`, optional `allow_unlisted` (default `false`),
  optional `only_ids` (comma-separated Bitrix item IDs — empty = all).
- Reads `BITRIX_WEBHOOK_URL` from repo secrets (masked, never echoed).
- Tees per-item output to an artifact (`fill-source-urls-log`) and pushes
  the summary line to the GitHub step summary.

Dispatch from the CLI (requires `gh` auth with `workflow` scope on this
repo):

```sh
# Dry-run, 20 items (safe default — no CRM writes)
gh workflow run fill-source-urls.yml \
  -f mode=dry-run -f limit=20

# Apply, 50 items, allowlist-only
gh workflow run fill-source-urls.yml \
  -f mode=apply -f limit=50

# Apply only specific reviewed item IDs (after auditing a dry-run that
# included false positives — use only_ids to narrow the apply to the
# items you have confirmed are safe).
gh workflow run fill-source-urls.yml \
  -f mode=apply -f only_ids=1220,1198
```

The CLI itself (`npm run fill-source-urls`) defaults to `--dry-run` and
never overwrites an existing `ufCrm8SourceUrl`; `apply` requires the
operator to explicitly select it in the workflow inputs.

The in-app UI remains available for environments where it is reliable
(single-instance Render web service) and is the right tool for quick
ad-hoc dry-runs. For batch enrichment on serverless, prefer the
GitHub Actions workflow.

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
the existing Render auto-deploy. It is additionally gated on the repo
variable `YC_DEPLOY_ENABLED == 'true'` — until that flag is set, every
run is a no-op.

> **Important.** Yandex Serverless Containers fully **replace** the
> revision environment on every deploy. Any env var that is not listed
> in the workflow's `yc serverless container revision deploy` call will
> be lost. Because of this, both the non-secret and the secret runtime
> env vars must be wired through GitHub. The workflow reads secrets via
> `${{ secrets.* }}` (which GitHub masks in logs) and passes them to
> `yc` through a shell args array — they are never echoed or printed.

### Repository **Variables** (Settings → Secrets and variables → Actions → Variables)

Non-secret, plain config. Safe to view/edit.

| name                  | example value                                |
| --------------------- | -------------------------------------------- |
| `YC_DEPLOY_ENABLED`   | `true` (must be the literal string)          |
| `YC_FOLDER_ID`        | `b1gxxxxxxxxxxxxxxxxx` (Yandex Cloud folder id — required so `yc` can resolve container/registry by name) |
| `YC_REGISTRY_ID`      | `crp1ii5pjvvu0ghb60oh`                       |
| `YC_CONTAINER_NAME`   | `bitrix-expo-app`                            |
| `YC_SA_ID`            | `ajev3fjbvssv56apd7bt`                       |
| `BITRIX_PORTAL`       | `b24-5syfa7.bitrix24.ru`                     |
| `BITRIX_UF_ENTITY_ID` | `CRM_8`                                      |
| `APP_BASE_URL`        | `https://bba8ln220jfloq5251dv.containers.yandexcloud.net` |
| `PARSE_RATE_LIMIT_MS` | `1000`                                       |
| `CRON_REPORT_CHANNEL` | `personal`                                   |
| `OWNER_USER_ID`       | `1`                                          |

### Repository **Secrets** (Settings → Secrets and variables → Actions → Secrets)

Sensitive — masked by GitHub in logs and never exposed in the workflow YAML.

| name                     | source                                                 |
| ------------------------ | ------------------------------------------------------ |
| `YC_SA_JSON_CREDENTIALS` | `yc iam key create --service-account-name <sa>` JSON   |
| `BITRIX_WEBHOOK_URL`     | Bitrix24 → Developer resources → Inbound webhook URL   |
| `ADMIN_JOB_TOKEN`        | `openssl rand -hex 32`                                 |
| `CRON_REPORT_CHAT_ID`    | *Optional.* Only when `CRON_REPORT_CHANNEL=chat`       |

The workflow **builds, pushes and deploys** the image, and assembles the
full revision env from these Variables and Secrets. Runtime app secrets
are no longer set in the Yandex Cloud console — they live in GitHub
Secrets so every deploy is reproducible.

### `rebind-placements (manual)` workflow

`.github/workflows/rebind-placements.yml` runs the existing safe-by-default
`npm run rebind-placements` script in GitHub Actions so the Bitrix24
placement cut-over (§ Cut-over from Render) can be done without a local
shell.

- **Trigger:** `workflow_dispatch` only.
- **Inputs:**
  - `mode` — `dry-run` (default) or `apply`. `apply` performs API writes.
  - `app_base_url` — optional override; when empty, `vars.APP_BASE_URL`
    is used.
  - `stale_base_url` — optional. When set, the script computes the exact
    handlers it would have generated under that base for the 7 managed
    routes and unbinds each via `placement.unbind` (tolerating "not found")
    before binding `APP_BASE_URL`. Provides a no-browser fallback when the
    webhook can't call `placement.get` / `placement.list`. Defaults to
    `https://calendar-interpro-app.onrender.com` (the previous Render
    deployment); blank it out for portals that never ran on Render.
- **Required Secret:** `BITRIX_WEBHOOK_URL` (already configured for the
  deploy workflow — same secret).
- **Required Variable:** `APP_BASE_URL` (already configured).
- The webhook value is read from `${{ secrets.* }}`, exported into the
  step env for the script, and never echoed.

Recommended flow:

1. Run with `mode = dry-run` first and inspect the plan in the job log.
   Confirm the planned `UNBIND ... (fallback)` lines target only the 7
   managed placement + route pairs under the stale host.
2. Run again with `mode = apply` once the plan looks right.

---

## Troubleshooting

- **`ERROR: can't resolve object by name without folder id`** during
  `yc serverless container revision deploy` (or `container get`) — the
  service-account session has no active folder. Set the repo Variable
  `YC_FOLDER_ID`; the workflow runs `yc config set folder-id "$YC_FOLDER_ID"`
  after auth and also passes `--folder-id` to the name-resolving commands.
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
