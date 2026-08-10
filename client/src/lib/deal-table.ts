export type DealTableSortKey = "title" | "client" | "stage" | "budget" | "manager";
export type SortDirection = "asc" | "desc";

export type SortableDealRow = {
  id: string;
  title: string;
  client: string;
  stageTitle?: string;
  stageSort?: number;
  budgetValue?: number;
  manager: string;
};

const russianCollator = new Intl.Collator("ru", {
  numeric: true,
  sensitivity: "base",
});

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

export function sortDealTableRows<T extends SortableDealRow>(
  rows: T[],
  key: DealTableSortKey,
  direction: SortDirection,
): T[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    let leftValue: string | number | undefined;
    let rightValue: string | number | undefined;

    if (key === "stage") {
      leftValue = left.stageSort ?? left.stageTitle;
      rightValue = right.stageSort ?? right.stageTitle;
    } else if (key === "budget") {
      leftValue = left.budgetValue;
      rightValue = right.budgetValue;
    } else {
      leftValue = left[key];
      rightValue = right[key];
    }

    const leftMissing = isMissing(leftValue);
    const rightMissing = isMissing(rightValue);
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;

    let compared = 0;
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      compared = leftValue - rightValue;
    } else {
      compared = russianCollator.compare(String(leftValue ?? ""), String(rightValue ?? ""));
    }
    if (compared !== 0) return compared * factor;

    const byTitle = russianCollator.compare(left.title, right.title);
    if (byTitle !== 0) return byTitle;
    return russianCollator.compare(left.id, right.id);
  });
}
