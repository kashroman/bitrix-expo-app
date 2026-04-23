import { callBx, CrmField, listAllBx } from "./bitrix";
import { EXPO_ENTITY_TYPE_ID, EXPO_LINK_FIELD } from "./config";

export type LinkFieldCandidate = {
  code: string;
  title: string;
  type?: string;
  isCustom: boolean;
  settings?: Record<string, unknown>;
  score: number;
  reason: string;
};

export type LinkFieldChoice = {
  entity: "lead" | "deal";
  candidates: LinkFieldCandidate[];
  chosenField?: string;
  chosenFormat?: string;
  attempted: { field: string; format: string; count: number; error?: string }[];
  sampleValues?: Array<{ id?: string; value?: unknown }>;
  hasCustom: boolean;
  usedFallback: boolean;
};

export type LinkFieldsCache = {
  lead: LinkFieldChoice;
  deal: LinkFieldChoice;
};

const ru = (s?: string) => (s ?? "").toLocaleLowerCase("ru-RU");

function titleMatchesExpoCalendar(title: string): number {
  const t = ru(title);
  if (!t) return 0;
  const trimmed = t.trim();
  if (trimmed === "выставка (календарь)" || trimmed === "выставка(календарь)") return 100;
  const hasExpo = t.includes("выстав") || t.includes("expo") || t.includes("exhibition");
  const hasCal = t.includes("календар") || t.includes("calendar");
  if (hasExpo && hasCal) return 60;
  if (hasExpo) return 20;
  return 0;
}

function isCustomUfCode(code: string): boolean {
  const upper = code.toUpperCase();
  return upper.startsWith("UF_") || upper.startsWith("UF_CRM") || code.startsWith("ufCrm");
}

function isParentField(code: string): boolean {
  return code.toUpperCase().startsWith("PARENT_ID_");
}

export function findLinkCandidates(fields: Record<string, CrmField>): LinkFieldCandidate[] {
  const out: LinkFieldCandidate[] = [];
  for (const [code, field] of Object.entries(fields ?? {})) {
    const title = field.title ?? code;
    const titleScore = titleMatchesExpoCalendar(title);
    const codeScore = titleMatchesExpoCalendar(code);
    const settings = (field.settings as Record<string, unknown> | undefined) ?? undefined;
    const settingsEntityType =
      Number(settings?.parentEntityTypeId ?? NaN) ||
      Number(settings?.ENTITY_TYPE_ID ?? NaN) ||
      Number(settings?.entityTypeId ?? NaN);
    const linksExpoByType = settingsEntityType === EXPO_ENTITY_TYPE_ID;
    const isParent = isParentField(code);
    const isUf = isCustomUfCode(code);

    let score = 0;
    const reasons: string[] = [];

    if (titleScore) {
      score += titleScore;
      reasons.push(`title "${title}" matches expo-calendar (${titleScore})`);
    }
    if (codeScore) {
      score += Math.floor(codeScore / 2);
      reasons.push(`code "${code}" matches expo-calendar (${Math.floor(codeScore / 2)})`);
    }
    if (linksExpoByType) {
      score += 40;
      reasons.push(`settings link to entityTypeId=${EXPO_ENTITY_TYPE_ID}`);
    }
    if (isUf) {
      score += 10;
      reasons.push("is user field");
    }
    if (isParent) {
      score -= 20;
      reasons.push("is PARENT_ID_* (downweighted vs UF)");
    }
    if (score <= 0 && !isParent) continue;

    out.push({
      code,
      title,
      type: field.type,
      isCustom: isUf,
      settings,
      score,
      reason: reasons.join("; "),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function filterFormats(expoId: string | number): Array<{ label: string; value: unknown }> {
  const idNum = Number(expoId);
  const idStr = String(expoId);
  return [
    { label: "numeric", value: Number.isFinite(idNum) ? idNum : idStr },
    { label: "string", value: idStr },
    { label: "T1050_<id>", value: `T${EXPO_ENTITY_TYPE_ID}_${idStr}` },
    { label: "DYNAMIC_1050_<id>", value: `DYNAMIC_${EXPO_ENTITY_TYPE_ID}_${idStr}` },
  ];
}

const LEAD_SELECT = [
  "ID",
  "TITLE",
  "STATUS_ID",
  "ASSIGNED_BY_ID",
  "DATE_CREATE",
  "DATE_MODIFY",
  "OPPORTUNITY",
  "CURRENCY_ID",
  "PHONE",
  "EMAIL",
  "NAME",
  "LAST_NAME",
  "SOURCE_ID",
];

const DEAL_SELECT = [
  "ID",
  "TITLE",
  "STAGE_ID",
  "CATEGORY_ID",
  "ASSIGNED_BY_ID",
  "DATE_CREATE",
  "DATE_MODIFY",
  "OPPORTUNITY",
  "CURRENCY_ID",
  "COMPANY_ID",
  "CONTACT_ID",
];

async function tryListWithField(
  method: "crm.lead.list" | "crm.deal.list",
  fieldCode: string,
  expoId: string | number,
  baseSelect: string[],
): Promise<{ rows: Record<string, unknown>[]; format: string; error?: string }> {
  const formats = filterFormats(expoId);
  const select = Array.from(new Set([...baseSelect, fieldCode]));
  for (const fmt of formats) {
    try {
      const rows = await listAllBx<Record<string, unknown>>(method, {
        filter: { [fieldCode]: fmt.value },
        select,
        order: { ID: "DESC" },
      }, { maxPages: 20 });
      if (rows.length > 0) {
        return { rows, format: fmt.label };
      }
    } catch (err) {
      return { rows: [], format: fmt.label, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { rows: [], format: "" };
}

export type EntityFetchOutcome = {
  entity: "lead" | "deal";
  rows: Record<string, unknown>[];
  choice: LinkFieldChoice;
};

export async function discoverLinkFields(entity: "lead" | "deal"): Promise<{
  candidates: LinkFieldCandidate[];
  hasCustom: boolean;
  fields: Record<string, CrmField>;
}> {
  const method = entity === "lead" ? "crm.lead.fields" : "crm.deal.fields";
  return resolveLinkFieldsFor(entity, method);
}

async function resolveLinkFieldsFor(
  entity: "lead" | "deal",
  method: "crm.lead.fields" | "crm.deal.fields",
): Promise<{ fields: Record<string, CrmField>; candidates: LinkFieldCandidate[]; hasCustom: boolean }> {
  const fields = await callBx<Record<string, CrmField>>(method, {});
  const allCandidates = findLinkCandidates(fields);
  const hasCustom = allCandidates.some((c) => c.isCustom && c.score > 0);
  const customCandidates = allCandidates.filter((c) => c.isCustom && c.score > 0);
  const parentCandidates = allCandidates.filter((c) => isParentField(c.code));
  const ordered = [...customCandidates, ...parentCandidates];
  void entity;
  return { fields, candidates: ordered.length ? ordered : allCandidates, hasCustom };
}

export async function fetchLinkedEntities(
  entity: "lead" | "deal",
  expoId: string | number,
): Promise<EntityFetchOutcome> {
  const method = entity === "lead" ? "crm.lead.fields" : "crm.deal.fields";
  const listMethod = entity === "lead" ? "crm.lead.list" : "crm.deal.list";
  const baseSelect = entity === "lead" ? LEAD_SELECT : DEAL_SELECT;

  const choice: LinkFieldChoice = {
    entity,
    candidates: [],
    attempted: [],
    hasCustom: false,
    usedFallback: false,
  };
  let rows: Record<string, unknown>[] = [];

  try {
    const resolved = await resolveLinkFieldsFor(entity, method);
    choice.candidates = resolved.candidates;
    choice.hasCustom = resolved.hasCustom;

    for (const candidate of resolved.candidates) {
      const formats = filterFormats(expoId);
      const select = Array.from(new Set([...baseSelect, candidate.code]));
      let found = false;
      for (const fmt of formats) {
        try {
          const list = await listAllBx<Record<string, unknown>>(listMethod, {
            filter: { [candidate.code]: fmt.value },
            select,
            order: { ID: "DESC" },
          }, { maxPages: 20 });
          choice.attempted.push({ field: candidate.code, format: fmt.label, count: list.length });
          if (list.length > 0 && !found) {
            rows = list;
            choice.chosenField = candidate.code;
            choice.chosenFormat = fmt.label;
            choice.usedFallback = isParentField(candidate.code) && resolved.hasCustom === false
              ? false
              : isParentField(candidate.code);
            choice.sampleValues = list.slice(0, 3).map((row) => ({
              id: row.ID ? String(row.ID) : undefined,
              value: row[candidate.code] ?? row[candidate.code.toLowerCase()],
            }));
            found = true;
            break;
          }
        } catch (err) {
          choice.attempted.push({
            field: candidate.code,
            format: fmt.label,
            count: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (found) break;
    }

    if (!choice.chosenField) {
      const fallback = EXPO_LINK_FIELD;
      if (!resolved.candidates.some((c) => c.code === fallback)) {
        const attempt = await tryListWithField(listMethod, fallback, expoId, baseSelect);
        choice.attempted.push({ field: fallback, format: attempt.format || "none", count: attempt.rows.length, error: attempt.error });
        if (attempt.rows.length > 0) {
          rows = attempt.rows;
          choice.chosenField = fallback;
          choice.chosenFormat = attempt.format;
          choice.usedFallback = true;
          choice.sampleValues = attempt.rows.slice(0, 3).map((row) => ({
            id: row.ID ? String(row.ID) : undefined,
            value: row[fallback] ?? row[fallback.toLowerCase()],
          }));
        }
      }
    }
  } catch (err) {
    choice.attempted.push({
      field: "(fields-discovery)",
      format: "",
      count: 0,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { entity, rows, choice };
}

export function candidateExpoIdFromRecord(record: Record<string, unknown> | undefined, choice: LinkFieldChoice | undefined):
  | { value: string; field: string }
  | undefined {
  if (!record) return undefined;
  const tried: string[] = [];
  if (choice?.chosenField) tried.push(choice.chosenField);
  for (const candidate of choice?.candidates ?? []) tried.push(candidate.code);
  tried.push(EXPO_LINK_FIELD);

  const normalizeValue = (raw: unknown): string | undefined => {
    if (raw === undefined || raw === null || raw === "" || raw === "0") return undefined;
    const first = Array.isArray(raw) ? raw[0] : raw;
    if (first === undefined || first === null || first === "" || first === "0") return undefined;
    const text = String(first);
    const m = text.match(/(?:T|DYNAMIC_)?\d*_?(\d+)$/);
    if (m) {
      const prefixMatch = text.match(/^(?:T(\d+)_|DYNAMIC_(\d+)_)(\d+)$/);
      if (prefixMatch) {
        const et = Number(prefixMatch[1] ?? prefixMatch[2]);
        if (et && et !== EXPO_ENTITY_TYPE_ID) return undefined;
        return String(prefixMatch[3]);
      }
      const bare = text.match(/^(\d+)$/);
      if (bare) return bare[1];
    }
    const numeric = text.match(/\d+/);
    return numeric ? numeric[0] : undefined;
  };

  const seen = new Set<string>();
  for (const code of tried) {
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const raw = record[code] ?? record[code.toLowerCase()] ?? record[code.toUpperCase()];
    const value = normalizeValue(raw);
    if (value) return { value, field: code };
  }
  return undefined;
}
