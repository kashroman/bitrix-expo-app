# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

**Project**: Bitrix24 external app for expo/exhibition management. Works inside Bitrix24 iframe, syncs data via `BX24.callMethod` (client-side SDK), manages exhibitions with dates, deals, and leads.

### Common Commands

```bash
npm run dev              # Start dev server (tsx server, Vite client HMR)
npm run build            # Build client (Vite) + server (esbuild) → dist/
npm run start            # Run production build from dist/
npm run check            # TypeScript check (no emit)
npm run test             # Run all tests (node:test, parsers/utils/server/lib)
npm test -- tests/parsers/expocentr.test.ts  # Single test file
npm run migrate          # Add UF-fields to CRM (requires BITRIX_WEBHOOK_URL)
npm run cron:weekly      # Manually trigger weekly check task
npm run fill-source-urls -- --dry-run --limit=50  # Preview URL fill, no write
npm run fill-source-urls -- --apply --limit=50    # Apply URL fill to CRM
```

## Architecture Overview

This is a **monorepo** with client, server, and shared code:

```
bitrix-expo-app/
├── client/               React app (Vite, Wouter, React Query, Radix UI)
│   └── src/
│       ├── pages/        Routes (calendar, install, crm-tabs, placement-*)
│       ├── components/   UI components + Gantt/build-schedule views
│       ├── lib/          Bitrix SDK wrappers, expo data models, config
│       └── hooks/        React Query queries to Bitrix (BX24.callMethod)
├── server/               Express app (Node.js server, serves client + API)
│   ├── index.ts         Entry: Express setup, routes, static serving
│   ├── routes.ts        API endpoints (/api/*)
│   ├── parsers/         Domain-specific parsers (expocentr, ITE sites, Crocus)
│   ├── lib/
│   │   ├── bitrix.ts    Bitrix REST wrapper (uses BITRIX_WEBHOOK_URL)
│   │   ├── expoFields.ts  UF-field mapping & Expo entity config
│   │   ├── smartEnrichment.ts  Parse logic, CRM create/update
│   │   ├── fillSourceUrls.ts   URL search via DuckDuckGo, allowlist gate
│   │   └── adminAuth.ts        x-admin-token validation
│   ├── utils/           calculateDates easing functions
│   ├── cron/            weekly-check.ts (scheduled via Render)
│   ├── storage.ts       (unused placeholder)
│   └── static.ts        Serve dist/public in production
├── shared/              Zod schemas (appConfig, exported types)
├── scripts/             CLI scripts (fill-source-urls standalone)
└── tests/               node:test suite (parsers, utils, server, lib)
```

## Key Systems

### Client-Server Data Flow

1. **Client (React)** runs inside Bitrix24 iframe
2. **No direct fetch calls** — all data via `BX24.callMethod(method, params, callback)` 
3. `client/src/lib/bitrix.ts`: `callBx()` wraps Bitrix SDK with timeouts + error handling
4. React Query caches responses, refetch/retry baked in

**Example flow** (Calendar page):
- `fetchExpoList()` → calls `crm.type.list` to find Expo entity type
- `fetchExposByMonth()` → calls `crm.dynamic.TYPE.list` to fetch exhibitions
- `fetchDealsByStage()` → calls `crm.deal.list` for deals linked to expo

### Server API (Stateful parsing + Bitrix writes)

All endpoints need `BITRIX_WEBHOOK_URL` configured to write back to CRM:

- `POST /api/smart-add` — Parse URL (expocentr.ru etc), return preview + confidence
- `POST /api/smart-add/confirm` — Create expo in CRM with parsed dates, write parse log
- `POST /api/manual-add` — Create expo from form (title, dates), no parsing
- `POST /api/recheck/:itemId` — Re-parse URL for one expo, update calculated dates
- `POST /api/recheck-all` — Bulk recheck all future expos, update dates
- `GET /api/smart-config` — Return Bitrix field IDs, entity type, webhook status
- `POST /api/admin/fill-source-urls` — Protected (x-admin-token), fill missing Source URLs via DuckDuckGo
- `GET /api/app-config` — App metadata (portal URL, company name, placement info)

### Database (SQLite via Drizzle)

**Minimal schema** — no migrations in repo yet, but `drizzle.config.ts` points to `.wrangler/wrangler.toml` (Cloudflare D1 in prod).

**Not used locally**: Parse logs and audit trails are stored in CRM UF-fields (`UF_CRM_8_PARSE_LOG` etc), not in app DB. Storage module exists but unused.

### Smart Enrichment (URL Parsing)

`server/parsers/` has domain-specific parsers:

- `expocentr.ts` — HTMLparsing, high confidence (1.0) when all blocks present
- `ite.ts` — Handles rosupack, neftegaz-expo, mitt.ru, intercharm.ru
- `crocus.ts` — Crocus-expo.ru fallback
- `photonicsExpo.ts` — Photonics-specific parser
- `generic.ts` — Regex fallback for unknown domains
- `dateUtils.ts` — Calculate montage/dismantleStart from exposed dates

**Confidence scoring** determines if record can be auto-written or needs review:
- `confidence >= 1.0` → auto-mark `VERIFIED=Y`
- `confidence < 1.0` → human review needed
- Calculated dates (montage/dismantle) → mark `CALCULATED=Y`

### Cron: Weekly Re-check

`server/cron/weekly-check.ts`:
- Runs Monday 06:00 UTC (via Render schedule)
- Fetches all future expos with Source URL
- Re-parses each, updates CRM if confidence >= 1.0
- Posts summary to Slack (optional `CRON_REPORT_CHAT_ID`)

### Admin: Fill Source URLs

`scripts/fill-source-urls.ts` + UI in `/placement-menu`:
- Searches DuckDuckGo for "official website" of unnamed expos
- Scores candidates by domain allowlist + keyword match
- Dry-run mode previews results without writes
- Apply mode writes to CRM with allowlist gate (can override with `--allow-unlisted`)

## Shared Code

`shared/schema.ts` exports **appConfigSchema** (Zod):

```ts
{
  portalUrl: string,
  company: string,
  appName: string,
  placements: { dealTab, dynamicTabTemplate, calendar },
}
```

Used by both client (app config UI) and server (returns /api/app-config).

## Development Workflow

1. **Local dev**: `npm run dev`
   - Runs `tsx server/index.ts` (watches TS changes)
   - Vite dev server on :5173 (client, with HMR)
   - Server reverse-proxies `/api` calls to avoid CORS
   - Test locally by accessing Bitrix iframe or using mock BX24 object

2. **Type check**: `npm run check` (incremental TypeScript, no emit)

3. **Test**:
   - Parser tests: `npm test -- tests/parsers/`
   - Run all: `npm test`
   - Tests use `node:test`, no external test runner

4. **Build & deploy**:
   - `npm run build` → `dist/public` (client) + `dist/index.cjs` (server bundle)
   - Server bundles dependencies via allowlist in `script/build.ts` (speeds cold start)
   - Deploy: Push to repo, Render auto-builds from this codebase

## Build Output

After `npm run build`:
- `dist/public/` — Static client (HTML + CSS + JS, ~500KB gzipped)
- `dist/index.cjs` — Bundled server (CommonJS, ~2MB)
- Server on startup calls `serveStatic(app)` to serve `dist/public`

## Configuration

**Environment variables** (see `.env.example`):

- `BITRIX_WEBHOOK_URL` — Required for server API calls (write to CRM)
- `BITRIX_PORTAL_URL` — Portal origin for iframe routing (default: b24-5syfa7.bitrix24.ru)
- `BITRIX_UF_ENTITY_ID` — CRM entity for userfieldconfig (default: CRM_8)
- `COMPANY_NAME` — App branding (default: interpro.pro)
- `ADMIN_JOB_TOKEN` — Protect `/api/admin/fill-source-urls` endpoint (generates 503 if unset)
- `OWNER_USER_ID`, `CRON_REPORT_CHAT_ID` — Slack reporting (optional)
- `PORT` — Server port (default: 5000)
- `NODE_ENV` — dev or production (controls Vite vs static serving)

**Build-time vars** (Vite, in client build only):

- `VITE_BITRIX_PORTAL_URL` — Used to build links to deals (graph-застройки tab)
- `VITE_BUILD_SCHEDULE_STAGE_IDS` — Whitelist deal stages for "график застройки" (default: 8,9,WON)

## Important Notes

- **Bitrix OAuth tokens**: Not stored server-side. All CRM writes via `BITRIX_WEBHOOK_URL` (inbound webhook token).
- **Permissions**: Client (iframe) inherits user context from portal. Server makes calls as webhook (must have `crm`, `user`, `im`, `userfieldconfig`, `placement` scopes).
- **No DB in local dev**: SQLite stub for dev; real app uses Cloudflare D1 (prod only). For local testing, parsers/enrichment work in-memory.
- **Placements**: Must be bound via `placement.bind` (done on `/install` page). If not bound, tabs won't appear.
- **Parser logs**: Stored in UF-field `UF_CRM_8_PARSE_LOG` (keeps last 10 entries). Re-opening same expo in UI shows parse history.

## Gotchas & Constraints

1. **Vite base path**: Set to `/` (app serves from root in Bitrix iframe)
2. **TypeScript strict mode**: Enabled; use `satisfies` / `as const` for strict types
3. **Tests**: Node:test only, no Jest/Vitest (keeps deps minimal)
4. **Drizzle migrations**: Not checked into repo (local `.wrangler/` only); migrations run via `npm run migrate` (server-side only)
5. **Parser reliability**: Some domains (Crocus, generic regex) have low confidence — always verify before auto-write
6. **Bitrix SDK**: Global `window.BX24` is lazy-loaded; app initializes via `initBitrix()` (waits for ready)

## Entry Points

- **Client**: `client/src/main.tsx` → App.tsx (Router with 8+ routes)
- **Server**: `server/index.ts` → Express + registerRoutes → static/API
- **Tests**: `tests/` (node:test, run via `npm test`)
- **Build script**: `script/build.ts` (esbuild for server, Vite for client)
