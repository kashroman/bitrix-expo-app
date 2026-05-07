/**
 * Idempotent placement binder for the calendar-interpro app.
 *
 * Runs against the inbound webhook (BITRIX_WEBHOOK_URL) so that we can call
 * `placement.bind` from a server shell without going through the in-iframe
 * BX24 SDK. Mirrors the targets registered by `client/src/pages/install.tsx`
 * — keep both lists in sync when adding a new placement.
 *
 * The Bitrix REST `placement.*` endpoints take UPPER_SNAKE_CASE params
 * (PLACEMENT, HANDLER, TITLE, ...). Do NOT switch to camelCase here — that
 * is a separate convention used by `userfieldconfig.*` (see migration 001).
 *
 * Usage:
 *   npm run bind-placements                 # unbind stale + bind all
 *   npm run bind-placements -- --dry-run    # print plan, no calls
 *   npm run bind-placements -- --check-fields  # also list UF status
 */

import "dotenv/config";
import { bx, hasWebhook, BitrixApiError } from "../server/lib/bitrix.js";

type Target = {
  placement: string;
  route: string;
  title: string;
};

const ENTITY_TYPE_ID = 1050;

function getAppBase(): string {
  const raw = (process.env.APP_BASE_URL ?? "").trim();
  const base = raw || "https://calendar-interpro-app.onrender.com";
  return base.replace(/\/+$/, "");
}

function buildTargets(appBase: string): Target[] {
  return [
    { placement: "CRM_DEAL_DETAIL_TAB", route: "/deal-tab", title: "Календарь выставок" },
    { placement: "CRM_LEAD_DETAIL_TAB", route: "/lead-tab", title: "Календарь выставок" },
    { placement: `CRM_DYNAMIC_${ENTITY_TYPE_ID}_DETAIL_TAB`, route: "/expo-tab", title: "Календарь выставки" },
    { placement: "CRM_ANALYTICS_MENU", route: "/calendar", title: "Календарь выставок" },
    { placement: `CRM_DYNAMIC_${ENTITY_TYPE_ID}_LIST_MENU`, route: "/placement-list", title: "Добавить по ссылке" },
    { placement: `CRM_DYNAMIC_${ENTITY_TYPE_ID}_DETAIL_TAB`, route: "/placement-detail", title: "Источник данных" },
    { placement: "LEFT_MENU", route: "/placement-menu", title: "Календарь выставок" },
  ];
}

function isNotFoundError(err: unknown): boolean {
  if (!(err instanceof BitrixApiError)) return false;
  const code = (err.code || "").toUpperCase();
  const desc = (err.description || "").toLowerCase();
  return (
    code.includes("NOT_FOUND") ||
    code.includes("ERROR_PLACEMENT_NOT_FOUND") ||
    code.includes("HANDLER_NOT_FOUND") ||
    desc.includes("not found") ||
    desc.includes("не найдено") ||
    desc.includes("no handler")
  );
}

function isAlreadyBound(err: unknown): boolean {
  if (!(err instanceof BitrixApiError)) return false;
  const code = (err.code || "").toUpperCase();
  const desc = (err.description || "").toLowerCase();
  return (
    code.includes("ALREADY") ||
    code.includes("ERROR_PLACEMENT_HANDLER_ALREADY_BIND") ||
    desc.includes("already") ||
    desc.includes("уже")
  );
}

async function unbind(target: Target, handler: string): Promise<{ ok: boolean; note: string }> {
  try {
    await bx("placement.unbind", {
      PLACEMENT: target.placement,
      HANDLER: handler,
    });
    return { ok: true, note: "unbound" };
  } catch (err) {
    if (isNotFoundError(err)) return { ok: true, note: "no prior binding" };
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, note: msg };
  }
}

async function bind(target: Target, handler: string): Promise<{ ok: boolean; alreadyBound: boolean; note: string }> {
  try {
    await bx("placement.bind", {
      PLACEMENT: target.placement,
      HANDLER: handler,
      TITLE: target.title,
      DESCRIPTION: target.title,
      GROUP_NAME: "interpro.pro",
    });
    return { ok: true, alreadyBound: false, note: "bound" };
  } catch (err) {
    if (isAlreadyBound(err)) return { ok: true, alreadyBound: true, note: "already bound" };
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, alreadyBound: false, note: msg };
  }
}

async function listRegistered(): Promise<Array<Record<string, any>> | null> {
  // Inbound webhooks expose `placement.get` for the current app and
  // `placement.list` from the system context. Try both gracefully.
  for (const method of ["placement.get", "placement.list"]) {
    try {
      const res: any = await bx(method, {});
      if (Array.isArray(res)) return res;
      if (res && typeof res === "object") {
        if (Array.isArray((res as any).items)) return (res as any).items;
        const vals = Object.values(res).filter((v) => v && typeof v === "object");
        if (vals.length) return vals as any[];
      }
    } catch {
      // try next method
    }
  }
  return null;
}

async function checkFields(): Promise<void> {
  const entityId = process.env.BITRIX_UF_ENTITY_ID ?? "CRM_8";
  const expected = [
    "UF_CRM_8_SOURCE_URL",
    "UF_CRM_8_LAST_CHECKED",
    "UF_CRM_8_VERIFIED",
    "UF_CRM_8_CALCULATED",
    "UF_CRM_8_PARSE_LOG",
  ];
  console.log(`[bind] check-fields entityId=${entityId}`);
  try {
    const list: any = await bx("userfieldconfig.list", {
      moduleId: "crm",
      filter: { entityId },
    });
    const arr = Array.isArray(list) ? list : Array.isArray(list?.items) ? list.items : [];
    const present = new Set<string>();
    for (const f of arr) {
      const name = f?.FIELD_NAME ?? f?.fieldName ?? f?.field_name;
      if (name) present.add(String(name));
    }
    for (const name of expected) {
      console.log(`[bind] field ${name}: ${present.has(name) ? "OK" : "MISSING"}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[bind] check-fields warning: ${msg}`);
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const wantCheckFields = process.argv.includes("--check-fields");
  const appBase = getAppBase();
  const targets = buildTargets(appBase);

  console.log(`[bind] appBase=${appBase} entityTypeId=${ENTITY_TYPE_ID} dryRun=${dryRun}`);
  console.log(`[bind] planned ${targets.length} handler(s):`);
  for (const t of targets) {
    console.log(`  - ${t.placement} -> ${appBase}${t.route}  (${t.title})`);
  }

  if (dryRun) {
    if (wantCheckFields && hasWebhook()) await checkFields();
    console.log("[bind] dry-run: nothing called");
    return;
  }

  if (!hasWebhook()) {
    console.error("[bind] BITRIX_WEBHOOK_URL is required for live runs.");
    process.exit(1);
  }

  const results: Array<{ placement: string; handler: string; bind: string; unbind: string }> = [];
  for (const target of targets) {
    const handler = `${appBase}${target.route}`;
    const u = await unbind(target, handler);
    const b = await bind(target, handler);
    results.push({
      placement: target.placement,
      handler,
      unbind: u.note,
      bind: b.note,
    });
    const tag = b.ok ? (b.alreadyBound ? "EXISTS" : "BOUND ") : "FAIL  ";
    console.log(`[bind] ${tag} ${target.placement} -> ${target.route} (unbind: ${u.note}; bind: ${b.note})`);
  }

  console.log("\n[bind] verifying via placement.get/list ...");
  const registered = await listRegistered();
  if (!registered) {
    console.warn("[bind] warning: placement.get/list unavailable via this webhook; trust the bind results above.");
  } else {
    const filtered = registered.filter((row) => {
      const handler = String(row.HANDLER ?? row.handler ?? "");
      return handler.includes(appBase);
    });
    console.log(`[bind] registered handlers under ${appBase}: ${filtered.length}`);
    for (const row of filtered) {
      const placement = String(row.PLACEMENT ?? row.placement ?? "");
      const handler = String(row.HANDLER ?? row.handler ?? "");
      const title = row.TITLE ?? row.title ?? "";
      console.log(`  - ${placement} -> ${handler}  (${title})`);
    }
  }

  if (wantCheckFields) await checkFields();

  const failed = results.filter((r) => r.bind.startsWith("Bitrix call") || r.bind.startsWith("HTTP_"));
  if (failed.length) {
    console.error(`[bind] ${failed.length} handler(s) failed`);
    process.exit(2);
  }
  console.log("[bind] done");
}

main().catch((err) => {
  console.error("[bind] fatal", err);
  process.exit(1);
});
