/**
 * Quick-search parity fixtures.
 *
 * Worker-eligible quick-search inputs used by parity tests to assert
 * that the main-thread and worker paths produce the same normalized
 * {@link RowIndexExecutionResult}. Every fixture must stay
 * worker-eligible — no custom parser, matcher, or getQuickFilterText.
 */

import { buildQuickSearchDependencyPlan } from "../../../features/quick-search/quickSearchDependencyPlan";
import type { ExecutionParityFixture } from "../types";

import type { QuickSearchOperationInput } from "./types";

type ParityInputBase = Omit<
  QuickSearchOperationInput,
  "dependencyPlan" | "sourceLayoutRevision" | "searchableDataRevision"
>;

function withCachedPlan(input: ParityInputBase): QuickSearchOperationInput {
  const dependencyPlan = buildQuickSearchDependencyPlan(
    input.columns,
    input.quickFilter ?? true,
  );
  return {
    ...input,
    dependencyPlan,
    sourceLayoutRevision: 0,
    searchableDataRevision: 0,
  };
}

export const quickSearchParityFixtures: readonly ExecutionParityFixture<QuickSearchOperationInput>[] =
  [
    {
      name: "text field match",
      input: withCachedPlan({
        rows: [
          { name: "Alice", city: "Lahore" },
          { name: "Bob", city: "London" },
          { name: "Charlie", city: "Paris" },
        ],
        quickFilterText: "ali",
        columns: [{ field: "name" }, { field: "city" }],
        searchableFieldsSignature: "sf|v|name,city",
        filterModel: {},
        filteredOrderVersion: 0,
      }),
    },
    {
      name: "no matches",
      input: withCachedPlan({
        rows: [
          { name: "Alice" },
          { name: "Bob" },
        ],
        quickFilterText: "zzz",
        columns: [{ field: "name" }],
        searchableFieldsSignature: "sf|v|name",
        filterModel: {},
        filteredOrderVersion: 0,
      }),
    },
    {
      name: "numeric projection field",
      input: withCachedPlan({
        rows: [
          { amount: 100, amountText: "100" },
          { amount: 200, amountText: "200" },
          { amount: 300, amountText: "300" },
        ],
        quickFilterText: "200",
        columns: [
          { field: "amount", quickFilterTextField: "amountText" },
        ],
        searchableFieldsSignature: "sf|v|amount:amountText",
        filterModel: {},
        filteredOrderVersion: 0,
      }),
    },
    {
      name: "sourceIndexes filtered subset",
      input: withCachedPlan({
        rows: [
          { name: "Alice" },
          { name: "Bob" },
          { name: "Charlie" },
          { name: "Anna" },
        ],
        quickFilterText: "a",
        columns: [{ field: "name" }],
        sourceIndexes: Uint32Array.from([0, 2, 3]),
        searchableFieldsSignature: "sf|v|name",
        filterModel: {},
        filteredOrderVersion: 1,
      }),
    },
    {
      name: "empty query returns upstream order",
      input: withCachedPlan({
        rows: [
          { name: "Alice" },
          { name: "Bob" },
        ],
        quickFilterText: "",
        columns: [{ field: "name" }],
        searchableFieldsSignature: "sf|v|name",
        filterModel: {},
        filteredOrderVersion: 0,
      }),
    },
    {
      name: "multi-word AND match",
      input: withCachedPlan({
        rows: [
          { name: "Alice", city: "Lahore" },
          { name: "Alice", city: "London" },
          { name: "Bob", city: "Lahore" },
        ],
        quickFilterText: "alice lahore",
        columns: [{ field: "name" }, { field: "city" }],
        searchableFieldsSignature: "sf|v|name,city",
        filterModel: {},
        filteredOrderVersion: 0,
      }),
    },
    {
      name: "formatted numeric projection with commas",
      input: withCachedPlan({
        rows: [
          { balance: 1234567, balanceText: "1234567 1,234,567" },
          { balance: 42, balanceText: "42" },
          { balance: 9999, balanceText: "9999 9,999" },
        ],
        quickFilterText: "234,567",
        columns: [
          { field: "balance", quickFilterTextField: "balanceText" },
        ],
        searchableFieldsSignature: "sf|v|balance:balanceText",
        filterModel: {},
        filteredOrderVersion: 0,
      }),
    },
    {
      name: "raw numeric search through projection field",
      input: withCachedPlan({
        rows: [
          { balance: 1234567, balanceText: "1234567 1,234,567" },
          { balance: 42, balanceText: "42" },
        ],
        quickFilterText: "1234567",
        columns: [
          { field: "balance", quickFilterTextField: "balanceText" },
        ],
        searchableFieldsSignature: "sf|v|balance:balanceText",
        filterModel: {},
        filteredOrderVersion: 0,
      }),
    },
    {
      name: "rating value through projection field",
      input: withCachedPlan({
        rows: [
          { rating: 5, ratingText: "5" },
          { rating: 3, ratingText: "3" },
          { rating: 0, ratingText: "0" },
        ],
        quickFilterText: "3",
        columns: [
          { field: "rating", quickFilterTextField: "ratingText" },
        ],
        searchableFieldsSignature: "sf|v|rating:ratingText",
        filterModel: {},
        filteredOrderVersion: 0,
      }),
    },
    {
      name: "boolean formatted projection — yes matches true row",
      input: withCachedPlan({
        rows: [
          { "game.bought": true, boughtText: "true Yes" },
          { "game.bought": false, boughtText: "false No" },
          { "game.bought": null, boughtText: "" },
        ],
        quickFilterText: "yes",
        columns: [
          { field: "game.bought", quickFilterTextField: "boughtText" },
        ],
        searchableFieldsSignature: "sf|v|game.bought:boughtText",
        filterModel: {},
        filteredOrderVersion: 0,
      }),
    },
    {
      name: "boolean formatted projection — no matches false row",
      input: withCachedPlan({
        rows: [
          { "game.bought": true, boughtText: "true Yes" },
          { "game.bought": false, boughtText: "false No" },
        ],
        quickFilterText: "no",
        columns: [
          { field: "game.bought", quickFilterTextField: "boughtText" },
        ],
        searchableFieldsSignature: "sf|v|game.bought:boughtText",
        filterModel: {},
        filteredOrderVersion: 0,
      }),
    },
    {
      name: "bucket/valueGetter-style projection — high matches bucketed rows",
      input: withCachedPlan({
        rows: [
          { oct: 80000, octText: "80000 High" },
          { oct: 50000, octText: "50000 Medium" },
          { oct: 10000, octText: "10000 Low" },
          { oct: 90000, octText: "90000 High" },
        ],
        quickFilterText: "high",
        columns: [
          { field: "oct", quickFilterTextField: "octText" },
        ],
        searchableFieldsSignature: "sf|v|oct:octText",
        filterModel: {},
        filteredOrderVersion: 0,
      }),
    },
    {
      name: "large dataset english match (>25k rows)",
      input: withCachedPlan((() => {
        const languages = ["English", "French", "German", "Spanish", "Italian"];
        const rows = Array.from({ length: 30_000 }, (_, i) => ({
          language: languages[i % languages.length],
        }));
        return {
          rows,
          quickFilterText: "english",
          columns: [{ field: "language" }],
          searchableFieldsSignature: "sf|v|language",
          filterModel: {},
          filteredOrderVersion: 0,
        };
      })()),
    },
  ];
