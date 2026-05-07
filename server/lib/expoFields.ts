/**
 * Server-side equivalents of client/src/lib/config.ts field codes.
 * Kept duplicated to avoid pulling React-side config into Node bundles.
 */

export const EXPO_ENTITY_TYPE_ID = 1050;

export const EXPO_DATE_FIELDS = {
  eventStart: "ufCrm8_1766066484758",
  eventEnd: "ufCrm8_1766066501630",
  mountStart: "ufCrm8_1778070067219",
  mountEnd: "ufCrm8_1778070672",
  dismantleStart: "ufCrm8_1778070708",
  dismantleEnd: "ufCrm8_1778070734",
} as const;

export const SMART_FIELDS = {
  sourceUrl: "ufCrm8SourceUrl",
  lastChecked: "ufCrm8LastChecked",
  verified: "ufCrm8Verified",
  calculated: "ufCrm8Calculated",
  parseLog: "ufCrm8ParseLog",
} as const;

/** Original (UF_CRM_8_*) names — used for `userfieldconfig.add` and as
 *  fallbacks when the REST response uses upper-case keys. */
export const SMART_FIELDS_ORIGINAL = {
  sourceUrl: "UF_CRM_8_SOURCE_URL",
  lastChecked: "UF_CRM_8_LAST_CHECKED",
  verified: "UF_CRM_8_VERIFIED",
  calculated: "UF_CRM_8_CALCULATED",
  parseLog: "UF_CRM_8_PARSE_LOG",
} as const;

/** Read a value from a CRM item under either the camelCase or original UF
 *  key, returning the first non-empty match. */
export function pickField(item: Record<string, any>, ...keys: string[]): any {
  for (const k of keys) {
    if (item[k] !== undefined && item[k] !== null && item[k] !== "") return item[k];
  }
  return undefined;
}
