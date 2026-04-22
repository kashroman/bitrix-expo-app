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

export function callBx<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
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
}

export async function listAllBx<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const first = await new Promise<BxResult<{ items?: T[]; types?: T[]; result?: T[] } | T[]>>(
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

  const rows: T[] = [];
  const collect = (data: { items?: T[]; types?: T[]; result?: T[] } | T[]) => {
    if (Array.isArray(data)) rows.push(...data);
    else if (Array.isArray(data.items)) rows.push(...data.items);
    else if (Array.isArray(data.types)) rows.push(...data.types);
    else if (Array.isArray(data.result)) rows.push(...data.result);
  };

  collect(first.data());

  let current = first;
  while (current.more && current.more() && current.next) {
    current = await new Promise((resolve, reject) => {
      current.next?.((nextResult) => {
        if (nextResult.error()) {
          reject(new Error(`${nextResult.error()}: ${nextResult.error_description() ?? ""}`));
          return;
        }
        resolve(nextResult as typeof current);
      });
    });
    collect(current.data());
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
  const basePath = window.location.pathname.replace(/\/(deal-tab|expo-tab|calendar|install)\/?$/, "/");
  return `${window.location.origin}${basePath}#${cleanRoute}`;
}
