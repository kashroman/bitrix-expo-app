import { CrmField } from "./bitrix";
import { getExpoFieldDiscovery } from "./expo-fields";

// These labels are the contract with the "Выставка" smart process. They are
// deliberately exact: a deadline must never be guessed from a similarly
// named field. The accreditation manager fills these fields manually.
export const ACCREDITATION_FIELD_TITLES = {
  standardDeadline: "Аккредитация: базовый срок",
  surchargeStart: "Аккредитация: начало коэффициента 1",
  surchargeRate: "Аккредитация: коэффициент 1",
  secondSurchargeStart: "Аккредитация: начало коэффициента 2",
  secondSurchargeRate: "Аккредитация: коэффициент 2",
  singleStoreyDeadline: "Аккредитация: одноэтажный стенд",
  doubleStoreyDeadline: "Аккредитация: двухэтажный стенд",
  suspensionDeadline: "Аккредитация: подвес",
  sourceUrl: "Аккредитация: источник",
  note: "Аккредитация: комментарий",
} as const;

export type AccreditationFieldKey = keyof typeof ACCREDITATION_FIELD_TITLES;
export type AccreditationFieldMap = Partial<Record<AccreditationFieldKey, string>>;

const normal = (value?: string) =>
  (value ?? "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();

function labelOf(field: CrmField): string {
  return normal(field.title ?? field.formLabel ?? field.listLabel);
}

let cached: AccreditationFieldMap | undefined;

export async function getAccreditationFieldMap(): Promise<AccreditationFieldMap> {
  if (cached) return cached;
  const discovery = await getExpoFieldDiscovery();
  const found: AccreditationFieldMap = {};
  for (const [key, title] of Object.entries(ACCREDITATION_FIELD_TITLES) as Array<
    [AccreditationFieldKey, string]
  >) {
    const expected = normal(title);
    const match = Object.entries(discovery.rawFields).find(([, field]) => labelOf(field) === expected);
    if (match) found[key] = match[0];
  }
  cached = found;
  return found;
}

export function getAccreditationFieldMapSync(): AccreditationFieldMap {
  return cached ?? {};
}

export function accreditationSelectCodes(): string[] {
  return Object.values(getAccreditationFieldMapSync()).filter(
    (code): code is string => Boolean(code),
  );
}
