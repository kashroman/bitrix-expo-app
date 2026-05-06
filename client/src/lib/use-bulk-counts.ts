import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  BulkCountsResult,
  ExpoCounts,
  fetchExpoCountsBulk,
} from "./expo-data";
import { isInsideBitrix } from "./bitrix";

export type BulkCountsState = {
  isEnabled: boolean;
  isLoading: boolean;
  isError: boolean;
  error?: string;
  data?: BulkCountsResult;
  byExpoId: Map<number, ExpoCounts> | undefined;
  diagnostics: BulkCountsResult["diagnostics"] | undefined;
  refetch: () => void;
};

// React Query is keyed by the sorted, comma-separated list of expo IDs so
// the same set of visible exhibitions reuses a single bulk fetch across
// the list view, Gantt rows, and any other consumer. Caller passes only
// the IDs they actually need counters for — never all 420 at once unless
// the visible list really does include every row.
export function useBulkExpoCounts(
  expoIds: Array<number | string>,
  options: { enabled?: boolean; staleTimeMs?: number } = {},
): BulkCountsState {
  const enabled =
    (options.enabled ?? true) && isInsideBitrix() && expoIds.length > 0;
  const sortedKey = useMemo(() => {
    const ids = Array.from(
      new Set(
        expoIds
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ).sort((a, b) => a - b);
    return ids;
  }, [expoIds]);

  const query = useQuery<BulkCountsResult>({
    queryKey: ["expo-counts-bulk", sortedKey],
    queryFn: () => fetchExpoCountsBulk(sortedKey),
    enabled: enabled && sortedKey.length > 0,
    staleTime: options.staleTimeMs ?? 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  return {
    isEnabled: enabled,
    isLoading: query.isFetching && !query.data,
    isError: query.isError,
    error:
      query.isError && query.error
        ? (query.error as Error).message ?? String(query.error)
        : undefined,
    data: query.data,
    byExpoId: query.data?.byExpoId,
    diagnostics: query.data?.diagnostics,
    refetch: () => query.refetch(),
  };
}
