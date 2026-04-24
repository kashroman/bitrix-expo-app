import { callBx, CrmField, listAllBx } from "./bitrix";
import {
  EXPO_ENTITY_TYPE_ID,
  EXPO_LINK_FIELD,
  ExpoLinkFormatOverride,
  manualExpoFieldCode,
  manualExpoFieldFormat,
} from "./config";

export type LinkFieldCandidate = {
  code: string;
  title: string;
  listLabel?: string;
  formLabel?: string;
  type?: string;
  userTypeId?: string;
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
  manualOverride?: string;
  manualOverrideActive: boolean;
  manualFormatOverride?: ExpoLinkFormatOverride;
  manualFormatOverrideActive: boolean;
  warnings: string[];
  bestCandidate?: LinkFieldCandidate;
  totalCandidateCount: number;
};

export type LinkFieldsCache = {
  lead: LinkFieldChoice;
  deal: LinkFieldChoice;
};

const ru = (s?: string) => (s ?? "").toLocaleLowerCase("ru-RU");

function normalize(s: string): string {
  return ru(s).replace(/[()\[\].,;:!?«»"'`]/g, " ").replace(/\s+/g, " ").trim();
}

function titleExpoCalendarScore(label: string): number {
  const n = normalize(label);
  if (!n) return 0;
  // Exact normalized match to "выставка календарь"
  if (n === "выставка календарь" || n === "выставка календарь ru" || n === "выставка календар") return 200;
  const hasExpo = n.includes("выстав");
  const hasCal = n.includes("календар");
  if (hasExpo && hasCal) return 150;
  if (hasExpo) return 10;
  return 0;
}

function codeExpoCalendarScore(code: string): number {
  const n = ru(code).replace(/_+/g, " ");
  const hasExpo = n.includes("expo") || n.includes("exhibition") || n.includes("vystav") || n.includes("выстав");
  const hasCal = n.includes("calendar") || n.includes("календар");
  if (hasExpo && hasCal) return 40;
  if (hasExpo) return 8;
  return 0;
}

function isCustomUfCode(code: string): boolean {
  const upper = code.toUpperCase();
  return upper.startsWith("UF_") || upper.startsWith("UF_CRM") || code.startsWith("ufCrm");
}

function isParentField(code: string): boolean {
  return code.toUpperCase().startsWith("PARENT_ID_");
}

function isCrmLikeField(field: CrmField): boolean {
  const userType = (field.userTypeId ?? "").toLowerCase();
  if (userType === "crm" || userType === "crm_entity" || userType === "element" || userType === "iblock_element") return true;
  if ((field.type ?? "").toLowerCase() === "crm") return true;
  const settings = field.settings as Record<string, unknown> | undefined;
  if (!settings) return false;
  const hasCrmKeys =
    "parentEntityTypeId" in settings ||
    "PARENT_ENTITY_TYPE_ID" in settings ||
    "LEAD" in settings ||
    "DEAL" in settings ||
    "CONTACT" in settings ||
    "COMPANY" in settings ||
    "DYNAMIC" in settings;
  return hasCrmKeys;
}

export function findLinkCandidates(fields: Record<string, CrmField>): LinkFieldCandidate[] {
  const out: LinkFieldCandidate[] = [];
  for (const [code, field] of Object.entries(fields ?? {})) {
    const title = field.title ?? code;
    const listLabel = field.listLabel;
    const formLabel = field.formLabel;
    const filterLabel = field.filterLabel;
    const labelCandidates = [title, listLabel, formLabel, filterLabel].filter(Boolean) as string[];
    const titleScore = Math.max(0, ...labelCandidates.map(titleExpoCalendarScore));
    const codeScore = codeExpoCalendarScore(code);
    const settings = (field.settings as Record<string, unknown> | undefined) ?? undefined;
    const settingsEntityType =
      Number(settings?.parentEntityTypeId ?? NaN) ||
      Number(settings?.ENTITY_TYPE_ID ?? NaN) ||
      Number(settings?.entityTypeId ?? NaN);
    const crmLike = isCrmLikeField(field);
    const linksExpoByType = settingsEntityType === EXPO_ENTITY_TYPE_ID;
    const isParent = isParentField(code);
    const isUf = isCustomUfCode(code);

    let score = 0;
    const reasons: string[] = [];

    if (titleScore) {
      score += titleScore;
      reasons.push(`label matches expo-calendar (+${titleScore})`);
    }
    if (codeScore) {
      score += codeScore;
      reasons.push(`code matches (+${codeScore})`);
    }
    if (linksExpoByType) {
      if (crmLike) {
        score += 80;
        reasons.push(`CRM-link field with parentEntityTypeId=${EXPO_ENTITY_TYPE_ID} (+80)`);
      } else {
        score += 10;
        reasons.push(`settings.parentEntityTypeId=${EXPO_ENTITY_TYPE_ID} but field not CRM-like (+10)`);
      }
    }
    if (isUf) {
      score += 5;
      reasons.push("UF field (+5)");
    }
    if (isParent) {
      score -= 20;
      reasons.push("PARENT_ID_* (-20)");
    }
    if (!titleScore && !codeScore && !linksExpoByType && !isParent) {
      // Not relevant enough to include
      continue;
    }
    if (score <= 0 && !isParent) continue;

    out.push({
      code,
      title,
      listLabel,
      formLabel,
      type: field.type,
      userTypeId: field.userTypeId,
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
  "STAGE_SEMANTIC_ID",
  "CATEGORY_ID",
  "ASSIGNED_BY_ID",
  "DATE_CREATE",
  "DATE_MODIFY",
  "OPPORTUNITY",
  "OPPORTUNITY_ACCOUNT",
  "CURRENCY_ID",
  "ACCOUNT_CURRENCY_ID",
  "COMPANY_ID",
  "COMPANY_TITLE",
  "CONTACT_ID",
  "CONTACT_IDS",
  "SOURCE_ID",
  "TYPE_ID",
  "CLOSED",
];

async function tryListWithField(
  method: "crm.lead.list" | "crm.deal.list",
  fieldCode: string,
  expoId: string | number,
  baseSelect: string[],
  pinnedFormat?: ExpoLinkFormatOverride,
): Promise<{ rows: Record<string, unknown>[]; format: string; attempts: { format: string; count: number; error?: string }[] }> {
  const all = filterFormats(expoId);
  const pinned = pinnedFormat ? all.find((f) => f.label === pinnedFormat) : undefined;
  const formats = pinned ? [pinned] : all;
  const select = Array.from(new Set([...baseSelect, fieldCode]));
  const attempts: { format: string; count: number; error?: string }[] = [];
  for (const fmt of formats) {
    try {
      const rows = await listAllBx<Record<string, unknown>>(method, {
        filter: { [fieldCode]: fmt.value },
        select,
        order: { ID: "DESC" },
      }, { maxPages: 20 });
      attempts.push({ format: fmt.label, count: rows.length });
      // When a format is pinned, accept the result (even 0 rows) without probing
      // further formats — the override is the source of truth.
      if (pinned) return { rows, format: fmt.label, attempts };
      if (rows.length > 0) {
        return { rows, format: fmt.label, attempts };
      }
    } catch (err) {
      attempts.push({ format: fmt.label, count: 0, error: err instanceof Error ? err.message : String(err) });
      // If a pinned format call errors, fall through to probing the remaining
      // formats so diagnostics stay safe.
      if (pinned) {
        const rest = all.filter((f) => f.label !== pinned.label);
        for (const fmt2 of rest) {
          try {
            const rows = await listAllBx<Record<string, unknown>>(method, {
              filter: { [fieldCode]: fmt2.value },
              select,
              order: { ID: "DESC" },
            }, { maxPages: 20 });
            attempts.push({ format: fmt2.label, count: rows.length });
            if (rows.length > 0) return { rows, format: fmt2.label, attempts };
          } catch (err2) {
            attempts.push({ format: fmt2.label, count: 0, error: err2 instanceof Error ? err2.message : String(err2) });
          }
        }
        return { rows: [], format: "", attempts };
      }
    }
  }
  return { rows: [], format: "", attempts };
}

export type EntityFetchOutcome = {
  entity: "lead" | "deal";
  rows: Record<string, unknown>[];
  choice: LinkFieldChoice;
};

export type LinkDiscoveryResult = {
  candidates: LinkFieldCandidate[];
  allCandidates: LinkFieldCandidate[];
  hasCustom: boolean;
  fields: Record<string, CrmField>;
  manualOverride?: string;
  manualOverrideActive: boolean;
  manualFormatOverride?: ExpoLinkFormatOverride;
  manualFormatOverrideActive: boolean;
  bestCandidate?: LinkFieldCandidate;
  warnings: string[];
  totalCandidateCount: number;
};

export async function discoverLinkFields(entity: "lead" | "deal"): Promise<LinkDiscoveryResult> {
  const method = entity === "lead" ? "crm.lead.fields" : "crm.deal.fields";
  return resolveLinkFieldsFor(entity, method);
}

async function resolveLinkFieldsFor(
  entity: "lead" | "deal",
  method: "crm.lead.fields" | "crm.deal.fields",
): Promise<LinkDiscoveryResult> {
  const fields = await callBx<Record<string, CrmField>>(method, {});
  const allCandidates = findLinkCandidates(fields);
  const warnings: string[] = [];
  const manualOverride = manualExpoFieldCode(entity) ?? undefined;
  const manualFormatOverride = manualExpoFieldFormat(entity);
  let manualOverrideActive = false;
  let orderedCandidates = allCandidates;
  let bestCandidate: LinkFieldCandidate | undefined = allCandidates[0];

  if (manualOverride) {
    const manualField = fields[manualOverride];
    if (manualField) {
      manualOverrideActive = true;
      const override: LinkFieldCandidate = {
        code: manualOverride,
        title: manualField.title ?? manualOverride,
        listLabel: manualField.listLabel,
        formLabel: manualField.formLabel,
        type: manualField.type,
        userTypeId: manualField.userTypeId,
        isCustom: isCustomUfCode(manualOverride),
        settings: manualField.settings,
        score: 9999,
        reason: "manual override from config",
      };
      orderedCandidates = [override, ...allCandidates.filter((c) => c.code !== manualOverride)];
      bestCandidate = override;
    } else {
      warnings.push(`manual override ${manualOverride} not present in ${method}`);
    }
  }

  const hasCustom = allCandidates.some((c) => c.isCustom && c.score > 0);

  if (!manualOverrideActive && bestCandidate) {
    if (bestCandidate.score < 60) {
      warnings.push(`best candidate score is low (${bestCandidate.score})`);
    }
    const tiedTop = allCandidates.filter((c) => c.score === bestCandidate!.score);
    if (tiedTop.length > 1) {
      warnings.push(`${tiedTop.length} candidates tied at top score ${bestCandidate.score}`);
    }
  }
  if (!bestCandidate && !manualOverrideActive) {
    warnings.push("no expo-calendar candidates discovered");
  }

  return {
    fields,
    candidates: orderedCandidates,
    allCandidates,
    hasCustom,
    manualOverride,
    manualOverrideActive,
    manualFormatOverride: manualFormatOverride ?? undefined,
    manualFormatOverrideActive: Boolean(manualFormatOverride),
    bestCandidate,
    warnings,
    totalCandidateCount: allCandidates.length,
  };
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
    manualOverrideActive: false,
    manualFormatOverrideActive: false,
    warnings: [],
    totalCandidateCount: 0,
  };
  let rows: Record<string, unknown>[] = [];

  try {
    const resolved = await resolveLinkFieldsFor(entity, method);
    choice.candidates = resolved.candidates;
    choice.hasCustom = resolved.hasCustom;
    choice.manualOverride = resolved.manualOverride;
    choice.manualOverrideActive = resolved.manualOverrideActive;
    choice.manualFormatOverride = resolved.manualFormatOverride;
    choice.manualFormatOverrideActive = resolved.manualFormatOverrideActive;
    choice.warnings = [...resolved.warnings];
    choice.bestCandidate = resolved.bestCandidate;
    choice.totalCandidateCount = resolved.totalCandidateCount;

    const pinnedFormat = resolved.manualFormatOverride ?? null;
    const allFormats = filterFormats(expoId);
    const pinnedEntry = pinnedFormat ? allFormats.find((f) => f.label === pinnedFormat) : undefined;
    const probeOrder = resolved.candidates.slice(0, 6);

    for (const candidate of probeOrder) {
      const select = Array.from(new Set([...baseSelect, candidate.code]));
      let found = false;

      // With a pinned format, try it first and accept whatever it returns
      // (including 0 rows) without probing other formats for this candidate.
      // Only a real API error triggers fallback probing.
      if (pinnedEntry) {
        let pinnedErrored = false;
        try {
          const list = await listAllBx<Record<string, unknown>>(listMethod, {
            filter: { [candidate.code]: pinnedEntry.value },
            select,
            order: { ID: "DESC" },
          }, { maxPages: 20 });
          choice.attempted.push({ field: candidate.code, format: pinnedEntry.label, count: list.length });
          if (list.length > 0) {
            rows = list;
            choice.chosenField = candidate.code;
            choice.chosenFormat = pinnedEntry.label;
            choice.usedFallback = isParentField(candidate.code);
            choice.sampleValues = list.slice(0, 3).map((row) => ({
              id: row.ID ? String(row.ID) : undefined,
              value: row[candidate.code] ?? row[candidate.code.toLowerCase()],
            }));
            found = true;
          }
        } catch (err) {
          pinnedErrored = true;
          choice.attempted.push({
            field: candidate.code,
            format: pinnedEntry.label,
            count: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        if (found) break;
        // Pinned call succeeded but returned 0 rows → skip this candidate
        // without trying other formats (deterministic behavior).
        if (!pinnedErrored) continue;
        // Pinned errored → fall through to full-format probing below.
      }

      const formats = pinnedEntry ? allFormats.filter((f) => f.label !== pinnedEntry.label) : allFormats;
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
            choice.usedFallback = isParentField(candidate.code) && !resolved.hasCustom ? false : isParentField(candidate.code);
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
        const attempt = await tryListWithField(listMethod, fallback, expoId, baseSelect, pinnedFormat ?? undefined);
        for (const a of attempt.attempts) {
          choice.attempted.push({ field: fallback, format: a.format, count: a.count, error: a.error });
        }
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

    if (!choice.chosenField) {
      choice.warnings.push("no rows returned for any candidate/format");
    }
  } catch (err) {
    choice.attempted.push({
      field: "(fields-discovery)",
      format: "",
      count: 0,
      error: err instanceof Error ? err.message : String(err),
    });
    choice.warnings.push(err instanceof Error ? err.message : String(err));
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

export function readRecordFieldValue(record: Record<string, unknown> | undefined, code: string): unknown {
  if (!record || !code) return undefined;
  return record[code] ?? record[code.toLowerCase()] ?? record[code.toUpperCase()];
}

export function summarizeSettings(settings: Record<string, unknown> | undefined): string {
  if (!settings) return "";
  const keys = Object.keys(settings);
  if (keys.length === 0) return "";
  const preferred = [
    "parentEntityTypeId",
    "PARENT_ENTITY_TYPE_ID",
    "entityTypeId",
    "ENTITY_TYPE_ID",
    "LEAD",
    "DEAL",
    "CONTACT",
    "COMPANY",
    "DISPLAY",
    "DEFAULT_VALUE",
  ];
  const picked = preferred
    .filter((k) => k in settings)
    .map((k) => `${k}=${JSON.stringify(settings[k])}`);
  // Surface DYNAMIC_* entries (e.g. DYNAMIC_1050) that are also load-bearing for CRM link fields.
  for (const k of keys) {
    if (k.startsWith("DYNAMIC_") && !picked.some((p) => p.startsWith(`${k}=`))) {
      picked.push(`${k}=${JSON.stringify(settings[k])}`);
    }
  }
  if (picked.length) return picked.join(", ");
  return keys.slice(0, 3).map((k) => `${k}=${JSON.stringify(settings[k])}`).join(", ");
}
