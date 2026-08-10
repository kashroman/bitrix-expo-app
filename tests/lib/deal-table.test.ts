import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sortDealTableRows, SortableDealRow } from "../../client/src/lib/deal-table.ts";

const rows: SortableDealRow[] = [
  { id: "3", title: "Вега", client: "Омега", stageTitle: "Строим", stageSort: 30, budgetValue: 300, manager: "Яковлев" },
  { id: "1", title: "Альфа", client: "Бета", stageTitle: "Проект", stageSort: 10, budgetValue: 100, manager: "Иванов" },
  { id: "2", title: "Бета", client: "Альфа", stageTitle: "Договор", stageSort: 20, budgetValue: 200, manager: "Петров" },
];

describe("exhibition deal table sorting", () => {
  it("sorts stages by their order in the sales pipeline", () => {
    assert.deepEqual(sortDealTableRows(rows, "stage", "asc").map((row) => row.id), ["1", "2", "3"]);
  });

  it("sorts managers in both directions", () => {
    assert.deepEqual(sortDealTableRows(rows, "manager", "asc").map((row) => row.id), ["1", "2", "3"]);
    assert.deepEqual(sortDealTableRows(rows, "manager", "desc").map((row) => row.id), ["3", "2", "1"]);
  });

  it("sorts budgets numerically instead of as text", () => {
    assert.deepEqual(sortDealTableRows(rows, "budget", "desc").map((row) => row.id), ["3", "2", "1"]);
  });
});
