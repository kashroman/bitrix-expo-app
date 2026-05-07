/**
 * Idempotent migration: add the smart-process userfields used by the smart
 * enrichment feature.
 *
 * Why CRM_8 and not CRM_1050:
 *   The user's spec referenced `CRM_1050` but the Bitrix24 admin UI for the
 *   "Выставки" smart process exposes `CRM_8` as the userfield entityId
 *   (entityTypeId 1050 → moduleId=crm, entityId=CRM_8). This mismatch is well
 *   known: the userfield entity is the smart-process numeric handle ("8"),
 *   not the entityTypeId. The default below matches the live admin layout;
 *   override with `BITRIX_UF_ENTITY_ID=CRM_1050` if your portal differs.
 *
 * Run with: `npm run migrate`. Requires `BITRIX_WEBHOOK_URL` to be set.
 *
 * Pass `--dry-run` to log the planned actions without calling Bitrix.
 */

import "dotenv/config";
import { bx, hasWebhook } from "../server/lib/bitrix.js";

type FieldSpec = {
  fieldName: string;
  userTypeId: "url" | "datetime" | "boolean" | "string";
  label: string;
  showInList?: "Y" | "N";
  defaultValue?: string;
  rowCount?: number;
};

const FIELDS: FieldSpec[] = [
  {
    fieldName: "UF_CRM_8_SOURCE_URL",
    userTypeId: "url",
    label: "Источник (URL)",
    showInList: "Y",
  },
  {
    fieldName: "UF_CRM_8_LAST_CHECKED",
    userTypeId: "datetime",
    label: "Дата последней проверки",
    showInList: "Y",
  },
  {
    fieldName: "UF_CRM_8_VERIFIED",
    userTypeId: "boolean",
    label: "Верифицировано",
    defaultValue: "0",
  },
  {
    fieldName: "UF_CRM_8_CALCULATED",
    userTypeId: "boolean",
    label: "Расчётные даты",
    defaultValue: "0",
  },
  {
    fieldName: "UF_CRM_8_PARSE_LOG",
    userTypeId: "string",
    label: "Лог парсинга",
    rowCount: 8,
  },
];

async function listExisting(entityId: string): Promise<Set<string>> {
  const list: any = await bx("userfieldconfig.list", {
    moduleId: "crm",
    filter: { ENTITY_ID: entityId },
  });
  const arr = Array.isArray(list) ? list : Array.isArray(list?.items) ? list.items : [];
  const out = new Set<string>();
  for (const f of arr) {
    const name = f?.FIELD_NAME ?? f?.fieldName ?? f?.field_name;
    if (name) out.add(String(name));
  }
  return out;
}

function buildAddPayload(entityId: string, spec: FieldSpec) {
  const edit = {
    EDIT_FORM_LABEL: { ru: spec.label, en: spec.label },
    LIST_COLUMN_LABEL: { ru: spec.label, en: spec.label },
    LIST_FILTER_LABEL: { ru: spec.label, en: spec.label },
    ERROR_MESSAGE: { ru: "", en: "" },
    HELP_MESSAGE: { ru: "", en: "" },
  };
  const settings: any = {};
  if (spec.rowCount) settings.ROWS = spec.rowCount;
  return {
    moduleId: "crm",
    field: {
      ENTITY_ID: entityId,
      FIELD_NAME: spec.fieldName,
      USER_TYPE_ID: spec.userTypeId,
      XML_ID: spec.fieldName,
      SORT: 500,
      MULTIPLE: "N",
      MANDATORY: "N",
      SHOW_FILTER: "N",
      SHOW_IN_LIST: spec.showInList ?? "N",
      EDIT_IN_LIST: "Y",
      IS_SEARCHABLE: "N",
      SETTINGS: settings,
      ...(spec.defaultValue !== undefined ? { DEFAULT_VALUE: spec.defaultValue } : {}),
      ...edit,
    },
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const entityId = process.env.BITRIX_UF_ENTITY_ID ?? "CRM_8";

  console.log(`[migrate] target entityId=${entityId}, dryRun=${dryRun}`);

  if (!dryRun && !hasWebhook()) {
    console.error("[migrate] BITRIX_WEBHOOK_URL is required for live runs.");
    process.exit(1);
  }

  let existing = new Set<string>();
  if (!dryRun) {
    existing = await listExisting(entityId);
    console.log(`[migrate] existing fields on ${entityId}: ${existing.size}`);
  }

  for (const spec of FIELDS) {
    if (existing.has(spec.fieldName)) {
      console.log(`[migrate] skip ${spec.fieldName} (already exists)`);
      continue;
    }
    const payload = buildAddPayload(entityId, spec);
    if (dryRun) {
      console.log(`[migrate] DRY would add ${spec.fieldName}:`, JSON.stringify(payload));
      continue;
    }
    try {
      const result: any = await bx("userfieldconfig.add", payload);
      console.log(`[migrate] +${spec.fieldName} → id=${result?.ID ?? result}`);
    } catch (err) {
      console.error(`[migrate] FAILED ${spec.fieldName}:`, err);
    }
  }
  console.log("[migrate] done");
}

main().catch((err) => {
  console.error("[migrate] fatal", err);
  process.exit(1);
});
