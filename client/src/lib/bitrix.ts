export type BxResult<T> = {
  data(): T;
  error(): string | null;
  error_description(): string | null;
  more?(): boolean;
  next?(callback: (result: BxResult<T>) => void): void;
};

export type PlacementInfo = {
  placement?: string;
  options?: Record<string, unknown>;
};

export type CrmField = {
  type?: string;
  title?: string;
  listLabel?: string;
  formLabel?: string;
  filterLabel?: string;
  userTypeId?: string;
  isReadOnly?: boolean;
  isImmutable?: boolean;
  isMultiple?: boolean;
  settings?: Record<string, unknown>;
};

export type CrmItem = Record<string, unknown> & {
  id?: number | string;
  title?: string;
};

export type SmartType = {
  id: number;
  title: string;
  code?: string;
  entityTypeId: number;
  isUseInUserfieldEnabled?: "Y" | "N";
  isBeginCloseDatesEnabled?: "Y" | "N";
};

declare global {
  interface Window {
    BX24?: {
      init(callback?: () => void): void;
      ready(callback: () => void): void;
      install(callback: () => void): void;
      installFinish(): void;
      callMethod<T = unknown>(
        method: string,
        params: Record<string, unknown>,
        callback: (result: BxResult<T>) => void,
      ): void;
      callBatch(
        calls: Record<string, [string, Record<string, unknown>]>,
        callback: (result: Record<string, BxResult<unknown>>) => void,
      ): void;
      placement: {
        info(): PlacementInfo;
      };
      openPath?(path: string, callback?: () => void): void;
    };
  }
}

export function isInsideBitrix(): boolean {
  return typeof window !== "undefined" && Boolean(window.BX24);
}

export function initBitrix(): Promise<void> {
  return new Promise((resolve) => {
    if (!window.BX24) {
      resolve();
      return;
    }
    window.BX24.init(() => resolve());
  });
}

const DEFAULT_BX_TIMEOUT_MS = 25_000;
const LIST_BX_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Таймаут Bitrix24 (${Math.round(ms / 1000)} с): ${label}`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function callBx<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_BX_TIMEOUT_MS,
): Promise<T> {
  const promise = new Promise<T>((resolve, reject) => {
    if (!window.BX24) {
      reject(new Error("BX24 SDK не найден. Откройте приложение внутри Bitrix24 или установите его."));
      return;
    }

    window.BX24.callMethod<T>(method, params, (result) => {
      if (result.error()) {
        reject(new Error(`${result.error()}: ${result.error_description() ?? ""}`));
        return;
      }
      resolve(result.data());
    });
  });
  return withTimeout(promise, timeoutMs, method);
}

export async function listAllBx<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  options: { timeoutMs?: number; maxPages?: number } = {},
): Promise<T[]> {
  const timeoutMs = options.timeoutMs ?? LIST_BX_TIMEOUT_MS;
  const maxPages = options.maxPages ?? 40;

  const firstPromise = new Promise<BxResult<{ items?: T[]; types?: T[]; result?: T[] } | T[]>>(
    (resolve, reject) => {
      if (!window.BX24) {
        reject(new Error("BX24 SDK не найден."));
        return;
      }
      window.BX24.callMethod(method, params, (result) => {
        if (result.error()) {
          reject(new Error(`${result.error()}: ${result.error_description() ?? ""}`));
          return;
        }
        resolve(result as BxResult<{ items?: T[]; types?: T[]; result?: T[] } | T[]>);
      });
    },
  );
  const first = await withTimeout(firstPromise, timeoutMs, method);

  const rows: T[] = [];
  const collect = (data: { items?: T[]; types?: T[]; result?: T[] } | T[]) => {
    if (Array.isArray(data)) rows.push(...data);
    else if (Array.isArray(data.items)) rows.push(...data.items);
    else if (Array.isArray(data.types)) rows.push(...data.types);
    else if (Array.isArray(data.result)) rows.push(...data.result);
  };

  collect(first.data());

  let current = first;
  let pages = 1;
  while (current.more && current.more() && current.next && pages < maxPages) {
    const nextPromise = new Promise<typeof current>((resolve, reject) => {
      current.next?.((nextResult) => {
        if (nextResult.error()) {
          reject(new Error(`${nextResult.error()}: ${nextResult.error_description() ?? ""}`));
          return;
        }
        resolve(nextResult as typeof current);
      });
    });
    current = await withTimeout(nextPromise, timeoutMs, `${method} page ${pages + 1}`);
    collect(current.data());
    pages += 1;
  }

  return rows;
}

export function getPlacementInfo(): PlacementInfo {
  if (!window.BX24) return {};
  try {
    return window.BX24.placement.info();
  } catch {
    return {};
  }
}

export function getPlacementEntityId(info: PlacementInfo): string | undefined {
  const options = info.options ?? {};
  const id = options.ID ?? options.id ?? options.entityId ?? options.ENTITY_ID;
  return id === undefined || id === null ? undefined : String(id);
}

export function openBitrixPath(path: string) {
  if (window.BX24?.openPath) {
    window.BX24.openPath(path);
    return;
  }
  window.open(path, "_blank", "noopener,noreferrer");
}

export function currentHandlerUrl(route: string): string {
  const cleanRoute = route.startsWith("/") ? route : `/${route}`;
  const basePath = window.location.pathname.replace(/\/(deal-tab|lead-tab|expo-tab|calendar|install)\/?$/, "/");
  return `${window.location.origin}${basePath.replace(/\/$/, "")}${cleanRoute}`;
}

export type RegisteredHandler = {
  placement: string;
  handler: string;
  title?: string;
  raw?: Record<string, unknown>;
};

const STALE_HOST_MARKERS = [
  "replit.app",
  "replit.dev",
  "riker.replit.dev",
  "bitrix-expo-app.replit.app",
  "replit.co",
  "repl.co",
];

const MANAGED_ROUTES = ["/deal-tab", "/lead-tab", "/expo-tab", "/calendar"];

export function getManagedPlacements(entityTypeId?: number): string[] {
  const placements = ["CRM_DEAL_DETAIL_TAB", "CRM_LEAD_DETAIL_TAB", "CRM_ANALYTICS_MENU"];
  if (entityTypeId) placements.push(`CRM_DYNAMIC_${entityTypeId}_DETAIL_TAB`);
  return placements;
}

export function openAppInNewTab(route: string) {
  const cleanRoute = route.startsWith("/") ? route : `/${route}`;
  const url = `${window.location.origin}${cleanRoute}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function normalizeRegisteredRows(data: unknown): RegisteredHandler[] {
  const rows: Record<string, unknown>[] = [];
  if (Array.isArray(data)) {
    rows.push(...(data as Record<string, unknown>[]));
  } else if (data && typeof data === "object") {
    const maybeResult = (data as { result?: unknown }).result;
    if (Array.isArray(maybeResult)) rows.push(...(maybeResult as Record<string, unknown>[]));
    else if (maybeResult && typeof maybeResult === "object") {
      rows.push(...(Object.values(maybeResult) as Record<string, unknown>[]).filter((v) => v && typeof v === "object"));
    }
  }
  return rows.map((row) => ({
    placement: String(row.PLACEMENT ?? row.placement ?? ""),
    handler: String(row.HANDLER ?? row.handler ?? ""),
    title: row.TITLE ? String(row.TITLE) : row.title ? String(row.title) : undefined,
    raw: row,
  }));
}

export async function listRegisteredPlacements(): Promise<RegisteredHandler[]> {
  const data = await callBx<unknown>("placement.get", {});
  return normalizeRegisteredRows(data);
}

export function isStaleHandler(handler: string, currentOrigin: string): boolean {
  if (!handler) return false;
  let url: URL;
  try {
    url = new URL(handler);
  } catch {
    return false;
  }
  const lowerHost = url.host.toLowerCase();
  if (STALE_HOST_MARKERS.some((marker) => lowerHost.includes(marker))) return true;
  const routeMatches = MANAGED_ROUTES.some((route) => url.pathname === route || url.pathname.endsWith(route));
  if (routeMatches && url.origin !== currentOrigin) return true;
  return false;
}

export function findStaleHandlers(
  registered: RegisteredHandler[],
  managedPlacements: string[],
  currentOrigin: string,
): RegisteredHandler[] {
  const managed = new Set(managedPlacements);
  return registered.filter(
    (row) => managed.has(row.placement) && isStaleHandler(row.handler, currentOrigin),
  );
}

export function callBxRaw<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<BxResult<T>> {
  return new Promise((resolve, reject) => {
    if (!window.BX24) {
      reject(new Error("BX24 SDK не найден."));
      return;
    }
    window.BX24.callMethod<T>(method, params, (result) => resolve(result));
  });
}

export function isAlreadyBoundError(error: string | null, description: string | null): boolean {
  const text = `${error ?? ""} ${description ?? ""}`.toLocaleLowerCase("en-US");
  return (
    text.includes("handler already binded") ||
    text.includes("already binded") ||
    text.includes("already bound") ||
    text.includes("handler_already_binded")
  );
}
