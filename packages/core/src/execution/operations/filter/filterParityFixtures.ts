import type { NormalizedColumnFilterConfig } from "../../../features/filters/types";
import type { ExecutionParityFixture } from "../types";

import type { FilterOperationInput } from "./types";

function textConfig() {
  return {
    type: "text" as const,
    defaultOperator: "contains" as const,
    caseSensitive: false,
    trimInput: true,
  };
}

function numberConfig() {
  return {
    type: "number" as const,
    defaultOperator: "equals" as const,
    caseSensitive: false,
    trimInput: true,
  };
}

function dateConfig() {
  return {
    type: "date" as const,
    defaultOperator: "equals" as const,
    caseSensitive: false,
    trimInput: true,
  };
}

function booleanConfig() {
  return {
    type: "boolean" as const,
    defaultOperator: "equals" as const,
    caseSensitive: false,
    trimInput: true,
  };
}

export const filterParityFixtures: readonly ExecutionParityFixture<FilterOperationInput>[] =
  [
    {
      name: "text contains",
      input: {
        rows: [
          { name: "Alice" },
          { name: "Bob" },
          { name: "Charlie" },
          { name: null },
        ],
        filterModel: {
          name: {
            type: "text",
            operator: "and",
            conditions: [{ operator: "contains", value: "li" }],
          },
        },
        columnsByField: new Map([["name", textConfig()]]),
      },
    },
    {
      name: "text two conditions OR",
      input: {
        rows: [
          { name: "Alice" },
          { name: "Bob" },
          { name: "Charlie" },
          { name: "Diana" },
        ],
        filterModel: {
          name: {
            type: "text",
            operator: "or",
            conditions: [
              { operator: "equals", value: "alice" },
              { operator: "equals", value: "bob" },
            ],
          },
        },
        columnsByField: new Map([["name", textConfig()]]),
      },
    },
    {
      name: "number between",
      input: {
        rows: [
          { val: 10 },
          { val: 20 },
          { val: 30 },
          { val: 40 },
          { val: null },
        ],
        filterModel: {
          val: {
            type: "number",
            operator: "and",
            conditions: [{ operator: "between", value: 15, valueTo: 35 }],
          },
        },
        columnsByField: new Map([["val", numberConfig()]]),
      },
    },
    {
      name: "date before",
      input: {
        rows: [
          { val: "2024-01-15" },
          { val: "2024-06-01" },
          { val: "2024-12-31" },
          { val: null },
        ],
        filterModel: {
          val: {
            type: "date",
            operator: "and",
            conditions: [{ operator: "before", value: "2024-06-01" }],
          },
        },
        columnsByField: new Map([["val", dateConfig()]]),
      },
    },
    {
      name: "date between",
      input: {
        rows: [
          { val: "2024-01-15" },
          { val: "2024-06-01" },
          { val: "2024-12-31" },
        ],
        filterModel: {
          val: {
            type: "date",
            operator: "and",
            conditions: [
              { operator: "between", value: "2024-01-01", valueTo: "2024-06-30" },
            ],
          },
        },
        columnsByField: new Map([["val", dateConfig()]]),
      },
    },
    {
      name: "boolean equals",
      input: {
        rows: [
          { val: true },
          { val: false },
          { val: "true" },
          { val: null },
          { val: 1 },
        ],
        filterModel: {
          val: {
            type: "boolean",
            operator: "and",
            conditions: [{ operator: "equals", value: true }],
          },
        },
        columnsByField: new Map([["val", booleanConfig()]]),
      },
    },
    {
      name: "multi-column AND",
      input: {
        rows: [
          { name: "Alice", age: 30 },
          { name: "Bob", age: 25 },
          { name: "Charlie", age: 35 },
          { name: "Alex", age: 20 },
        ],
        filterModel: {
          name: {
            type: "text",
            operator: "and",
            conditions: [{ operator: "contains", value: "a" }],
          },
          age: {
            type: "number",
            operator: "and",
            conditions: [{ operator: "gte", value: 30 }],
          },
        },
        columnsByField: new Map<string, NormalizedColumnFilterConfig>([
          ["name", textConfig()],
          ["age", numberConfig()],
        ]),
      },
    },
    {
      name: "sourceIndexes subset",
      input: {
        rows: [
          { name: "Alice" },
          { name: "Bob" },
          { name: "Charlie" },
          { name: "Alice" },
        ],
        filterModel: {
          name: {
            type: "text",
            operator: "and",
            conditions: [{ operator: "contains", value: "ali" }],
          },
        },
        columnsByField: new Map([["name", textConfig()]]),
        sourceIndexes: [0, 1, 3],
      },
    },
    {
      name: "null/isNull behavior",
      input: {
        rows: [
          { val: 10 },
          { val: null },
          { val: NaN },
          { val: Infinity },
          { val: "abc" },
        ],
        filterModel: {
          val: {
            type: "number",
            operator: "and",
            conditions: [{ operator: "isNull" }],
          },
        },
        columnsByField: new Map([["val", numberConfig()]]),
      },
    },
    {
      name: "text in",
      input: {
        rows: [
          { name: "Alice" },
          { name: "Bob" },
          { name: "Charlie" },
          { name: null },
        ],
        filterModel: {
          name: {
            type: "text",
            operator: "and",
            conditions: [{ operator: "in", value: ["alice", "charlie"] }],
          },
        },
        columnsByField: new Map([["name", textConfig()]]),
      },
    },
    {
      name: "text notIn",
      input: {
        rows: [
          { name: "Alice" },
          { name: "Bob" },
          { name: "Charlie" },
          { name: null },
        ],
        filterModel: {
          name: {
            type: "text",
            operator: "and",
            conditions: [{ operator: "notIn", value: ["alice"] }],
          },
        },
        columnsByField: new Map([["name", textConfig()]]),
      },
    },
    {
      name: "number in",
      input: {
        rows: [
          { val: 10 },
          { val: 20 },
          { val: 30 },
          { val: null },
        ],
        filterModel: {
          val: {
            type: "number",
            operator: "and",
            conditions: [{ operator: "in", value: [10, 30] }],
          },
        },
        columnsByField: new Map([["val", numberConfig()]]),
      },
    },
    {
      name: "number notIn",
      input: {
        rows: [
          { val: 10 },
          { val: 20 },
          { val: 30 },
          { val: null },
        ],
        filterModel: {
          val: {
            type: "number",
            operator: "and",
            conditions: [{ operator: "notIn", value: [10] }],
          },
        },
        columnsByField: new Map([["val", numberConfig()]]),
      },
    },
    {
      name: "date in",
      input: {
        rows: [
          { val: "2024-01-15" },
          { val: "2024-06-01" },
          { val: "2024-12-31" },
          { val: null },
        ],
        filterModel: {
          val: {
            type: "date",
            operator: "and",
            conditions: [{ operator: "in", value: ["2024-01-15", "2024-12-31"] }],
          },
        },
        columnsByField: new Map([["val", dateConfig()]]),
      },
    },
    {
      name: "boolean in",
      input: {
        rows: [
          { val: true },
          { val: false },
          { val: null },
        ],
        filterModel: {
          val: {
            type: "boolean",
            operator: "and",
            conditions: [{ operator: "in", value: [true] }],
          },
        },
        columnsByField: new Map([["val", booleanConfig()]]),
      },
    },
    {
      name: "text selection only",
      input: {
        rows: [
          { name: "Alice" },
          { name: "Bob" },
          { name: "Charlie" },
          { name: null },
        ],
        filterModel: {
          name: {
            type: "text",
            operator: "and",
            conditions: [],
            selection: { operator: "in", values: ["alice", "charlie"] },
          },
        },
        columnsByField: new Map([["name", textConfig()]]),
      },
    },
    {
      name: "text typed AND + selection",
      input: {
        rows: [
          { name: "Alice" },
          { name: "Alex" },
          { name: "Bob" },
          { name: "Charlie" },
        ],
        filterModel: {
          name: {
            type: "text",
            operator: "and",
            conditions: [{ operator: "startsWith", value: "al" }],
            selection: { operator: "in", values: ["alice", "alex", "bob"] },
          },
        },
        columnsByField: new Map([["name", textConfig()]]),
      },
    },
    {
      name: "text typed OR + selection",
      input: {
        rows: [
          { name: "Alice" },
          { name: "Alex" },
          { name: "Bob" },
          { name: "Charlie" },
        ],
        filterModel: {
          name: {
            type: "text",
            operator: "or",
            conditions: [
              { operator: "equals", value: "charlie" },
              { operator: "equals", value: "bob" },
            ],
            selection: { operator: "in", values: ["bob"] },
          },
        },
        columnsByField: new Map([["name", textConfig()]]),
      },
    },
    {
      name: "number typed + selection",
      input: {
        rows: [
          { val: 10 },
          { val: 20 },
          { val: 30 },
          { val: 40 },
          { val: null },
        ],
        filterModel: {
          val: {
            type: "number",
            operator: "and",
            conditions: [{ operator: "gte", value: 20 }],
            selection: { operator: "in", values: [20, 30] },
          },
        },
        columnsByField: new Map([["val", numberConfig()]]),
      },
    },
    {
      name: "number typed OR + selection",
      input: {
        rows: [
          { val: 10 },
          { val: 20 },
          { val: 30 },
          { val: 40 },
        ],
        filterModel: {
          val: {
            type: "number",
            operator: "or",
            conditions: [
              { operator: "equals", value: 10 },
              { operator: "equals", value: 30 },
            ],
            selection: { operator: "in", values: [30, 40] },
          },
        },
        columnsByField: new Map([["val", numberConfig()]]),
      },
    },
    {
      name: "invalid date/null behavior",
      input: {
        rows: [
          { val: "2024-01-15" },
          { val: "2024-02-31" },
          { val: "not-a-date" },
          { val: null },
        ],
        filterModel: {
          val: {
            type: "date",
            operator: "and",
            conditions: [{ operator: "isNull" }],
          },
        },
        columnsByField: new Map([["val", dateConfig()]]),
      },
    },
  ];
