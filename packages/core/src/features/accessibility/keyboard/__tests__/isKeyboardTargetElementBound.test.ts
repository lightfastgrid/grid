// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE,
  COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE,
  COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE,
} from "../../../../internal/columnGroupHeaderDomMetadata";
import { isKeyboardTargetElementBound } from "../isKeyboardTargetElementBound";
import {
  createKeyboardTargetState,
  setBodyCellTarget,
  setFloatingFilterTarget,
  setGroupHeaderTarget,
  setLeafHeaderTarget,
} from "../keyboardTarget";
import type { KeyboardNavigationPlan } from "../navigationPlan";

const PLAN: KeyboardNavigationPlan = {
  columns: [
    {
      field: "a",
      ordinal: 0,
      pin: "center",
      column: { field: "a" },
    },
    {
      field: "b",
      ordinal: 1,
      pin: "center",
      column: { field: "b" },
    },
  ],
  columnOrdinalByField: new Map([
    ["a", 0],
    ["b", 1],
  ]),
  firstDataColumnOrdinal: 0,
  lastDataColumnOrdinal: 1,
  previousDataColumnOrdinal: [-1, 0],
  nextDataColumnOrdinal: [1, -1],
  groupRows: [
    {
      level: 0,
      spans: [
        {
          level: 0,
          groupId: "all",
          headerName: "All",
          startColumnOrdinal: 0,
          endColumnOrdinal: 1,
        },
      ],
    },
  ],
  hasFloatingFilterRow: true,
  topologyRevision: 1,
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("exact keyboard target binding", () => {
  it("accepts only the exact body row and field binding", () => {
    const row = document.createElement("div");
    row.setAttribute("data-row-index", "3");
    const cell = document.createElement("div");
    cell.setAttribute("data-col-id", "b");
    row.appendChild(cell);
    document.body.appendChild(row);

    const target = createKeyboardTargetState();
    setBodyCellTarget(target, 3, 3, 1);

    expect(isKeyboardTargetElementBound(cell, target, PLAN)).toBe(true);

    row.style.display = "none";
    expect(isKeyboardTargetElementBound(cell, target, PLAN)).toBe(false);

    row.style.display = "";
    row.setAttribute("data-row-index", "4");
    expect(isKeyboardTargetElementBound(cell, target, PLAN)).toBe(false);

    row.setAttribute("data-row-index", "3");
    cell.setAttribute("data-col-id", "a");
    expect(isKeyboardTargetElementBound(cell, target, PLAN)).toBe(false);

    cell.setAttribute("data-col-id", "b");
    row.remove();
    expect(isKeyboardTargetElementBound(cell, target, PLAN)).toBe(false);
  });

  it("accepts only the exact leaf and floating-filter field binding", () => {
    const element = document.createElement("div");
    element.setAttribute("data-col-id", "b");
    document.body.appendChild(element);
    const target = createKeyboardTargetState();

    setLeafHeaderTarget(target, 1);
    expect(isKeyboardTargetElementBound(element, target, PLAN)).toBe(true);

    setFloatingFilterTarget(target, 1);
    expect(isKeyboardTargetElementBound(element, target, PLAN)).toBe(true);

    element.style.display = "none";
    expect(isKeyboardTargetElementBound(element, target, PLAN)).toBe(false);

    element.style.display = "";
    element.setAttribute("data-col-id", "a");
    expect(isKeyboardTargetElementBound(element, target, PLAN)).toBe(false);
  });

  it("accepts only the planned group level and span boundaries", () => {
    const row = document.createElement("div");
    row.setAttribute(COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE, "0");
    const span = document.createElement("div");
    span.setAttribute(COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE, "a");
    span.setAttribute(COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE, "b");
    row.appendChild(span);
    document.body.appendChild(row);

    const target = createKeyboardTargetState();
    setGroupHeaderTarget(target, 0, 0, 0);

    expect(isKeyboardTargetElementBound(span, target, PLAN)).toBe(true);

    row.style.display = "none";
    expect(isKeyboardTargetElementBound(span, target, PLAN)).toBe(false);

    row.style.display = "";
    span.setAttribute(COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE, "a");
    expect(isKeyboardTargetElementBound(span, target, PLAN)).toBe(false);

    span.setAttribute(COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE, "b");
    row.setAttribute(COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE, "1");
    expect(isKeyboardTargetElementBound(span, target, PLAN)).toBe(false);

    setGroupHeaderTarget(target, 0, 1, 0);
    expect(isKeyboardTargetElementBound(span, target, PLAN)).toBe(false);
  });
});
