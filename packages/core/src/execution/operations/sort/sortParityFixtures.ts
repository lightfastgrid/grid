/**
 * Sort parity fixtures.
 *
 * Worker-eligible sort inputs used by parity tests to assert that the
 * main-thread and worker sort paths produce the same normalized
 * {@link RowIndexExecutionResult}. Every fixture must stay
 * worker-eligible — no `valueGetter`, no custom `sortComparator` —
 * otherwise the worker path has nothing to compare against.
 */

import type { ExecutionParityFixture } from "../types";

import type { SortOperationInput } from "./types";

/** Worker-eligible inputs exercised by sort parity tests. */
export const sortParityFixtures: readonly ExecutionParityFixture<SortOperationInput>[] =
  [
    {
      name: "ascending number sort",
      input: {
        rows: [{ amount: 30 }, { amount: 10 }, { amount: 20 }],
        sortModel: [{ field: "amount", sort: "asc" }],
        columns: [{ field: "amount" }],
      },
    },
    {
      name: "descending number sort",
      input: {
        rows: [{ amount: 10 }, { amount: 30 }, { amount: 20 }],
        sortModel: [{ field: "amount", sort: "desc" }],
        columns: [{ field: "amount" }],
      },
    },
    {
      name: "string sort",
      input: {
        rows: [{ name: "cherry" }, { name: "apple" }, { name: "banana" }],
        sortModel: [{ field: "name", sort: "asc" }],
        columns: [{ field: "name" }],
      },
    },
    {
      name: "boolean sort",
      input: {
        rows: [{ active: true }, { active: false }, { active: true }],
        sortModel: [{ field: "active", sort: "asc" }],
        columns: [{ field: "active" }],
      },
    },
    {
      name: "null/undefined values",
      input: {
        rows: [
          { score: null },
          { score: 5 },
          { score: undefined },
          { score: 1 },
        ],
        sortModel: [{ field: "score", sort: "asc" }],
        columns: [{ field: "score" }],
      },
    },
    {
      name: "dot-path sort",
      input: {
        rows: [
          { user: { age: 40 } },
          { user: { age: 20 } },
          { user: { age: 30 } },
        ],
        sortModel: [{ field: "user.age", sort: "asc" }],
        columns: [{ field: "user.age" }],
      },
    },
    {
      name: "multi-column sort",
      input: {
        rows: [
          { group: "b", amount: 1 },
          { group: "a", amount: 2 },
          { group: "a", amount: 1 },
          { group: "b", amount: 2 },
        ],
        sortModel: [
          { field: "group", sort: "asc" },
          { field: "amount", sort: "desc" },
        ],
        columns: [{ field: "group" }, { field: "amount" }],
      },
    },
    {
      name: "stable equal values",
      input: {
        rows: [
          { rank: 1, label: "first" },
          { rank: 1, label: "second" },
          { rank: 1, label: "third" },
        ],
        sortModel: [{ field: "rank", sort: "asc" }],
        columns: [{ field: "rank" }],
      },
    },
  ];
