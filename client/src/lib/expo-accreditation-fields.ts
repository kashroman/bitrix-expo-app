import { CrmField } from "./bitrix";
import { getExpoFieldDiscovery } from "./expo-fields";

// Exact labels of manually maintained fields in the “Выставка” smart process.
// Matching only by the complete label prevents a deadline from being guessed.
export const ACCREDITATION_FIELD_TITLES = {
  singleStoreyBase: "Аккредитация одноэтажного стенда",
  singleStorey50: "Аккредитация одноэтажного стенда +50%",
  singleStorey100: "Аккредитация одноэтажного стенда +100%",
  doubleStoreyBase: "Аккредитация двухэтажного стенда",
  doubleStorey50: "Аккредитация двухэтажного стенда +50%",
  doubleStorey100: "Аккредитация двухэтажного стенда +100%",
  outdoorBase: "Аккредитация уличной экспозиции",
  outdoor50: "Аккредитация уличной экспозиции +50%",
  outdoor100: "Аккредитация уличной экспозиции +100%",
  suspensionBase: "Аккредитация подвесов",
  suspension50: "Аккредитация подвесов +50%",
  suspension100: "Аккредитация подвесов +100%",
} as const;

export type AccreditationFieldKey = keyof typeof ACCREDITATION_FIELD_TITLES;
export type AccreditationFieldMap = Partial<Record<AccreditationFieldKey, string>>;

export type AccreditationGroupKey = "singleStorey" | "doubleStorey" | "outdoor" | "suspension";
export type AccreditationLevel = "base" | "fifty" | "hundred";

export type AccreditationGroup = {
  key: AccreditationGroupKey;
  label: string;
  fields: Record<AccreditationLevel, AccreditationFieldKey>;
};

export const ACCREDITATION_GROUPS: AccreditationGroup[] = [
  {
    key: "singleStorey",
    label: "Одноэтажный стенд",
    fields: { base: "singleStoreyBase", fifty: "singleStorey50", hundred: "singleStorey100" },
  },
  {
    key: "doubleStorey",
    label: "Двухэтажный стенд",
    fields: { base: "doubleStoreyBase", fifty: "doubleStorey50", hundred: "doubleStorey100" },
  },
  {
    key: "outdoor",
    label: "Уличная экспозиция",
    fields: { base: "outdoorBase", fifty: "outdoor50", hundred: "outdoor100" },
  },
  {
    key: "suspension",
    label: "Подвесы",
    fields: { base: "suspensionBase", fifty: "suspension50", hundred: "suspension100" },
  },
];

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
