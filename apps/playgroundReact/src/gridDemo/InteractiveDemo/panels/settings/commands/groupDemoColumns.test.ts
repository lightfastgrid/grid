import type { LightFastGridColumnInput } from "@lightfastgrid/core";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  groupDemoColumns,
  resolveDemoColumns,
} from "./groupDemoColumns.ts";

type DemoColumnGroup = Extract<
  LightFastGridColumnInput,
  { children: LightFastGridColumnInput[] }
>;

function isDemoColumnGroup(
  node: LightFastGridColumnInput,
  groupId: string,
): node is DemoColumnGroup {
  return "children" in node && node.groupId === groupId;
}

const LEAVES: LightFastGridColumnInput[] = [
  { field: "__rowNumber", headerName: "ID", pinned: "left" },
  { field: "name", headerName: "Customer", pinned: "left" },
  { field: "email", headerName: "Email" },
  { field: "status", headerName: "Status" },
  { field: "bankBalance", headerName: "Balance" },
  { field: "mystery", headerName: "Mystery" },
];

describe("groupDemoColumns", () => {
  it("keeps pinned-left leaves as top-level", () => {
    const grouped = groupDemoColumns(LEAVES);
    assert.equal("field" in grouped[0]! && grouped[0].field, "__rowNumber");
    assert.equal("field" in grouped[1]! && grouped[1].field, "name");
  });

  it("nests known fields into groups", () => {
    const grouped = groupDemoColumns(LEAVES);
    const customer = grouped.find((node): node is DemoColumnGroup =>
      isDemoColumnGroup(node, "customer"),
    );
    if (!customer) {
      throw new Error("expected customer group");
    }
    assert.deepEqual(
      customer.children.map((child) =>
        "field" in child ? child.field : null,
      ),
      ["email"],
    );

    const financial = grouped.find((node): node is DemoColumnGroup =>
      isDemoColumnGroup(node, "financial"),
    );
    if (!financial) {
      throw new Error("expected financial group");
    }
    assert.deepEqual(
      financial.children.map((child) =>
        "field" in child ? child.field : null,
      ),
      ["bankBalance"],
    );
  });

  it("appends unknown leaves ungrouped", () => {
    const grouped = groupDemoColumns(LEAVES);
    const mystery = grouped.find(
      (node) => "field" in node && node.field === "mystery",
    );
    assert.ok(mystery);
  });

  it("resolveDemoColumns returns flat copy when grouped is off", () => {
    const resolved = resolveDemoColumns(LEAVES, false);
    assert.deepEqual(
      resolved.map((node) => ("field" in node ? node.field : null)),
      LEAVES.map((node) => ("field" in node ? node.field : null)),
    );
    assert.notEqual(resolved, LEAVES);
  });
});
