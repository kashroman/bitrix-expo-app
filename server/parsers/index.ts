import { ParseResult, Fetcher } from "./types.js";
import { parseExpocentr } from "./expocentr.js";
import { parseIte } from "./ite.js";
import { parseCrocus } from "./crocus.js";
import { parseGeneric } from "./generic.js";

export type { ParseResult } from "./types.js";

const ITE_HOSTS = new Set([
  "rosupack.com",
  "neftegaz-expo.ru",
  "mitt.ru",
  "intercharm.ru",
  "www.rosupack.com",
  "www.neftegaz-expo.ru",
  "www.mitt.ru",
  "www.intercharm.ru",
]);

const EXPOCENTR_HOSTS = new Set([
  "expocentr.ru",
  "www.expocentr.ru",
]);

const CROCUS_HOSTS = new Set([
  "crocus-expo.ru",
  "www.crocus-expo.ru",
]);

export function dispatchHost(host: string): "expocentr" | "ite" | "crocus" | "generic" {
  const h = host.toLowerCase();
  if (EXPOCENTR_HOSTS.has(h)) return "expocentr";
  if (ITE_HOSTS.has(h)) return "ite";
  if (CROCUS_HOSTS.has(h)) return "crocus";
  return "generic";
}

export function parseHtml(html: string, url: string): ParseResult {
  const host = safeHost(url);
  const which = dispatchHost(host);
  switch (which) {
    case "expocentr":
      return parseExpocentr(html, url);
    case "ite":
      return parseIte(html, url, host);
    case "crocus":
      return parseCrocus(html, url);
    default:
      return parseGeneric(html, url, host);
  }
}

export async function parseUrl(url: string, fetcher?: Fetcher): Promise<ParseResult> {
  const f: Fetcher = fetcher ?? defaultFetcher;
  try {
    const { html, finalUrl } = await f(url);
    return parseHtml(html, finalUrl);
  } catch (err) {
    return {
      confidence: 0,
      notes: [
        `fetch error: ${err instanceof Error ? err.message : String(err)}`,
      ],
      url,
      host: safeHost(url),
      parser: "fetch-failed",
    };
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const defaultFetcher: Fetcher = async (url: string) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; bitrix-expo-app/1.0; +https://calendar-interpro-app.onrender.com)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return { html, finalUrl: res.url || url };
  } finally {
    clearTimeout(t);
  }
};
