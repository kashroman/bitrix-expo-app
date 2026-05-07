/**
 * Pragmatic server-side Bitrix24 REST wrapper.
 *
 * Two operational modes are supported:
 *
 * 1. Inbound webhook (BITRIX_WEBHOOK_URL): preferred for migrations, cron and
 *    server endpoints because it requires no token storage. Set
 *    BITRIX_WEBHOOK_URL to e.g. https://b24-5syfa7.bitrix24.ru/rest/1/<token>/
 *
 * 2. OAuth: env placeholders (BITRIX_CLIENT_ID/SECRET, BITRIX_PORTAL,
 *    APP_BASE_URL) are accepted for future use. Full server-side OAuth token
 *    storage and refresh is NOT implemented in this PR — calls in OAuth-only
 *    mode will throw a `webhook-required` error.
 */

export class BitrixWebhookRequiredError extends Error {
  constructor(method: string) {
    super(
      `Bitrix call "${method}" requires BITRIX_WEBHOOK_URL. ` +
        `Server OAuth token storage is not yet implemented.`,
    );
    this.name = "BitrixWebhookRequiredError";
  }
}

export class BitrixApiError extends Error {
  readonly code: string;
  readonly description: string;
  constructor(method: string, code: string, description: string) {
    super(`Bitrix call "${method}" failed: ${code} ${description}`.trim());
    this.name = "BitrixApiError";
    this.code = code;
    this.description = description;
  }
}

function getWebhookBase(): string | undefined {
  const raw = process.env.BITRIX_WEBHOOK_URL?.trim();
  if (!raw) return undefined;
  return raw.endsWith("/") ? raw : `${raw}/`;
}

export function hasWebhook(): boolean {
  return Boolean(getWebhookBase());
}

export function bitrixConfigSummary() {
  return {
    hasWebhook: hasWebhook(),
    portal: process.env.BITRIX_PORTAL ?? null,
    hasOAuth: Boolean(process.env.BITRIX_CLIENT_ID && process.env.BITRIX_CLIENT_SECRET),
    ufEntityId: process.env.BITRIX_UF_ENTITY_ID ?? "CRM_8",
  };
}

type BxResponse<T> = {
  result: T;
  total?: number;
  next?: number;
  error?: string;
  error_description?: string;
  time?: { duration?: number };
};

export async function bx<T = any>(
  method: string,
  params: Record<string, any> = {},
): Promise<T> {
  const base = getWebhookBase();
  if (!base) throw new BitrixWebhookRequiredError(method);
  const url = `${base}${method}.json`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  let json: BxResponse<T>;
  try {
    json = (await res.json()) as BxResponse<T>;
  } catch (err) {
    throw new BitrixApiError(
      method,
      `HTTP_${res.status}`,
      `Non-JSON response: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (json.error) {
    throw new BitrixApiError(method, json.error, json.error_description ?? "");
  }
  return json.result;
}

/**
 * Page through a list-style endpoint (e.g. crm.item.list) using the `next`
 * cursor returned by Bitrix. Concatenates `result.items` (or `result`) arrays.
 */
export async function bxListAll<T = any>(
  method: string,
  params: Record<string, any> = {},
  itemsKey: string = "items",
): Promise<T[]> {
  const out: T[] = [];
  let start = 0;
  let safety = 0;
  while (safety < 50) {
    safety++;
    const result: any = await bx<any>(method, { ...params, start });
    const chunk: T[] = Array.isArray(result)
      ? (result as T[])
      : Array.isArray(result?.[itemsKey])
        ? (result[itemsKey] as T[])
        : [];
    out.push(...chunk);
    const next = (result as any)?.next;
    if (typeof next === "number" && next > start) {
      start = next;
    } else {
      break;
    }
  }
  return out;
}
