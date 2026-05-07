# Changelog

## [Unreleased] — Smart Enrichment

Adds the smart-enrichment feature: create exhibition cards by URL with
automatic parsing, manual creation with subsequent auto-check, and a weekly
background sweep that updates montage/dismantle dates from organizer sites.

### Added
- Server-side Bitrix REST wrapper (`server/lib/bitrix.ts`) with inbound
  webhook support and OAuth env placeholders for future use.
- HTML parsers for `expocentr.ru`, `rosupack.com` / `neftegaz-expo.ru` /
  `mitt.ru` / `intercharm.ru` (ITE-style), `crocus-expo.ru` and a generic
  Russian-keyword fallback.
- API endpoints: `POST /api/smart-add`, `POST /api/smart-add/confirm`,
  `POST /api/manual-add`, `POST /api/recheck/:itemId`, `POST /api/recheck-all`,
  `GET /api/smart-config`.
- Migration script (`migrations/001_add_source_fields.ts`) for the new
  smart-process userfields: `UF_CRM_8_SOURCE_URL`, `UF_CRM_8_LAST_CHECKED`,
  `UF_CRM_8_VERIFIED`, `UF_CRM_8_CALCULATED`, `UF_CRM_8_PARSE_LOG`. Run with
  `npm run migrate`; supports `--dry-run`.
- Render cron (`render.yaml`) — Mondays at 06:00 UTC, runs
  `server/cron/weekly-check.ts` with `p-queue`-style domain rate-limiting.
- Three new placement pages: `/placement-list` (CRM_DYNAMIC_1050_LIST_MENU,
  "Добавить по ссылке"), `/placement-detail` (CRM_DYNAMIC_1050_DETAIL_TAB,
  "Источник данных"), `/placement-menu` (LEFT_MENU, "Календарь выставок").
- Vitest-style `node:test` suites covering the expocentr parser, Russian
  date range util and the working-day montage/dismantle heuristic.
- `.env.example`, README sections, and this changelog.

### Behavior guarantees
- Auto-updates (recheck and cron) **never overwrite** non-empty fields.
- Each auto-update writes a Bitrix timeline comment and appends a line to
  the parse log (last 10 entries kept).
- `VERIFIED=Y` is set only when `confidence >= 1.0`.
- `CALCULATED=Y` is set only when montage/dismantle were filled by the
  3-working-day heuristic in `server/utils/calculateDates.ts`.

### Operator action required to go live
- Set `BITRIX_WEBHOOK_URL` on Render (and locally for dev).
- Run `npm run migrate` once after deploy.
- Re-run app installation in Bitrix24 so the new placements bind.
- Confirm the inbound webhook scopes include: `crm`, `user`, `im`,
  `userfieldconfig`, `placement`.
