// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  syncFloatingFilterColumnSelectionDom,
} from "../syncColumnSelectionDom";

describe("syncFloatingFilterColumnSelectionDom", () => {
  it("toggles lfg-column-selected on floating filter cells", () => {
    const root = document.createElement("div");
    const row = document.createElement("div");
    row.className = "lfg-floating-filter-row";

    const selectedCell = document.createElement("div");
    selectedCell.className = "lfg-floating-filter-cell";
    selectedCell.setAttribute("data-col-id", "email");

    const otherCell = document.createElement("div");
    otherCell.className = "lfg-floating-filter-cell";
    otherCell.setAttribute("data-col-id", "name");

    row.append(selectedCell, otherCell);
    root.appendChild(row);

    syncFloatingFilterColumnSelectionDom(root, (field) => field === "email");

    expect(selectedCell.classList.contains("lfg-column-selected")).toBe(true);
    expect(otherCell.classList.contains("lfg-column-selected")).toBe(false);

    syncFloatingFilterColumnSelectionDom(root, () => false);

    expect(selectedCell.classList.contains("lfg-column-selected")).toBe(false);
  });
});
