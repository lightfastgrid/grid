import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countActiveFilters } from "./countActiveFilters.ts";

describe("countActiveFilters", () => {
  it("returns 0 for empty or missing models", () => {
    assert.equal(countActiveFilters(undefined), 0);
    assert.equal(countActiveFilters({}), 0);
  });

  it("counts top-level filter fields", () => {
    assert.equal(
      countActiveFilters({
        name: {
          type: "text",
          conditions: [{ operator: "contains", value: "a" }],
        },
        status: {
          type: "text",
          conditions: [{ operator: "equals", value: "Active" }],
        },
      }),
      2,
    );
  });
});
