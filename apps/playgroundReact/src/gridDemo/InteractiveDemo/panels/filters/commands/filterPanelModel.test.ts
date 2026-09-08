import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCommitModel,
  buildDemoFilterRows,
  createDefaultFilterModel,
  createDemoFilterDraft,
  mergeFilterEditorRows,
  nextAvailableFilterColumn,
  operatorNeedsValue,
  readSelectOptions,
  withConditionOperator,
  withConditionValue,
  withoutChipValue,
} from "./filterPanelModel.ts";

describe("buildDemoFilterRows", () => {
  it("maps condition and selection models", () => {
    const rows = buildDemoFilterRows({
      filterModel: {
        country: {
          type: "text",
          operator: "and",
          conditions: [{ operator: "equals", value: "Germany" }],
        },
        status: {
          type: "text",
          operator: "and",
          conditions: [],
          selection: { operator: "in", values: ["Active", "Probation"] },
        },
      },
      columns: [
        { field: "country", headerName: "Country" },
        { field: "status", headerName: "Status" },
      ],
    });

    assert.equal(rows.length, 2);
    const firstRow = rows[0];
    const secondRow = rows[1];
    assert.ok(firstRow);
    assert.ok(secondRow);
    assert.equal(firstRow.kind, "condition");
    assert.equal(firstRow.valueText, "Germany");
    assert.equal(secondRow.kind, "selection");
    assert.deepEqual(secondRow.chips, ["Active", "Probation"]);
  });
});

describe("filter model helpers", () => {
  it("updates operator and value on a default model", () => {
    const base = createDefaultFilterModel("text", "contains");
    const withOp = withConditionOperator(base, "equals");
    assert.equal(withOp.conditions[0]?.operator, "equals");
    const withValue = withConditionValue(withOp, "Germany");
    assert.equal(withValue.conditions[0]?.value, "Germany");
  });

  it("removes chips and clears when empty", () => {
    const model = {
      type: "text" as const,
      operator: "and" as const,
      conditions: [],
      selection: { operator: "in" as const, values: ["Active", "Probation"] },
    };
    const next = withoutChipValue(model, "Active");
    assert.deepEqual(next?.selection?.values, ["Probation"]);
    assert.equal(withoutChipValue(next!, "Probation"), null);
  });
});

describe("draft + commit helpers", () => {
  it("reads select options from floatingFilter config", () => {
    assert.deepEqual(readSelectOptions(true), []);
    assert.deepEqual(
      readSelectOptions({ control: "select", options: ["Active", "Probation"] }),
      ["Active", "Probation"],
    );
    assert.deepEqual(
      readSelectOptions({
        options: [{ value: "de", label: "Germany" }],
      }),
      ["de"],
    );
  });

  it("creates selection drafts for option columns", () => {
    const draft = createDemoFilterDraft(
      {
        field: "status",
        label: "Status",
        type: "text",
        defaultOperator: "contains",
        selectOptions: ["Active", "Probation"],
      },
      "d1",
    );
    assert.equal(draft.kind, "selection");
    assert.equal(draft.operator, "in");
    assert.deepEqual(draft.chips, []);
  });

  it("buildCommitModel rejects incomplete values and accepts valid ones", () => {
    assert.equal(
      buildCommitModel({
        type: "text",
        kind: "condition",
        operator: "contains",
        valueText: "",
        chips: [],
      }),
      null,
    );
    assert.deepEqual(
      buildCommitModel({
        type: "text",
        kind: "condition",
        operator: "contains",
        valueText: "acme",
        chips: [],
      }),
      {
        type: "text",
        operator: "and",
        conditions: [{ operator: "contains", value: "acme" }],
      },
    );
    assert.deepEqual(
      buildCommitModel({
        type: "text",
        kind: "condition",
        operator: "isEmpty",
        valueText: "",
        chips: [],
      }),
      {
        type: "text",
        operator: "and",
        conditions: [{ operator: "isEmpty" }],
      },
    );
    assert.deepEqual(
      buildCommitModel({
        type: "text",
        kind: "selection",
        operator: "in",
        valueText: "",
        chips: ["Active"],
      }),
      {
        type: "text",
        operator: "and",
        conditions: [],
        selection: { operator: "in", values: ["Active"] },
      },
    );
  });

  it("mergeFilterEditorRows prefers drafts over committed for same field", () => {
    const columns = [
      {
        field: "name",
        label: "Customer",
        type: "text" as const,
        defaultOperator: "contains" as const,
        selectOptions: [],
      },
      {
        field: "status",
        label: "Status",
        type: "text" as const,
        defaultOperator: "contains" as const,
        selectOptions: ["Active"],
      },
    ];
    const rows = mergeFilterEditorRows({
      committed: [
        {
          field: "name",
          label: "Customer",
          type: "text",
          kind: "condition",
          operator: "contains",
          valueText: "a",
          chips: [],
        },
      ],
      drafts: [
        {
          id: "d1",
          field: "status",
          kind: "selection",
          operator: "in",
          valueText: "",
          chips: [],
        },
      ],
      columns,
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.draftId, null);
    assert.equal(rows[1]?.draftId, "d1");
    assert.equal(
      nextAvailableFilterColumn(columns, new Set(rows.map((row) => row.field))),
      null,
    );
  });

  it("operatorNeedsValue is false for blank checks", () => {
    assert.equal(operatorNeedsValue("isEmpty"), false);
    assert.equal(operatorNeedsValue("contains"), true);
  });
});
