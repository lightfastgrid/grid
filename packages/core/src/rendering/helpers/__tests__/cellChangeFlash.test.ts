// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import type { ColumnDef, PooledCell, PooledRow, RowData } from "../../../types";
import { CSS } from "../../const/css-classes";
import {
  clearCellChangeFlash,
  clearRowCellChangeFlashes,
  isCellChangeFlashAnimationName,
  restartCellChangeFlash,
  syncCellChangeFlash,
  tryClearCellChangeFlashOnAnimationEnd,
} from "../cellChangeFlash";
import {
  type ColumnWindow,
  populateRow,
  type PopulateRowOptions,
} from "../populateRow";

function makeCell(): PooledCell {
  const el = document.createElement("div");
  el.className = CSS.CELL;
  return { element: el, value: "" };
}

function makePoolRow(): PooledRow {
  const element = document.createElement("div");
  element.className = CSS.ROW;
  const cells = [makeCell(), makeCell()];
  for (const cell of cells) element.appendChild(cell.element);
  return {
    element,
    cells,
    rowIndex: -1,
    rowVersion: 0,
    rowId: null,
  };
}

describe("cellChangeFlash helper", () => {
  it("restarts with alternating animation classes", () => {
    const cell = makeCell();
    restartCellChangeFlash(cell);
    expect(cell.flashAnim).toBe(0);
    expect(cell.element.classList.contains(CSS.CELL_CHANGE_FLASH)).toBe(true);
    expect(cell.element.classList.contains(CSS.CELL_CHANGE_FLASH_A)).toBe(true);

    restartCellChangeFlash(cell);
    expect(cell.flashAnim).toBe(1);
    expect(cell.element.classList.contains(CSS.CELL_CHANGE_FLASH_A)).toBe(false);
    expect(cell.element.classList.contains(CSS.CELL_CHANGE_FLASH_B)).toBe(true);

    clearCellChangeFlash(cell);
    expect(cell.flashAnim).toBeUndefined();
    expect(cell.element.classList.contains(CSS.CELL_CHANGE_FLASH)).toBe(false);
  });

  it("flashes a rebound direct-field cell when the one-shot flash map targets it", () => {
    const cell = makeCell();
    cell.value = "Bob";
    syncCellChangeFlash(cell, {
      column: { field: "name", cellChangeFlash: true },
      wasBoundToSameCell: false,
      flashFields: new Set(["name"]),
      prevDisplay: "Bob",
      nextDisplay: "Alicia",
    });
    expect(cell.element.classList.contains(CSS.CELL_CHANGE_FLASH)).toBe(true);
  });

  it("clears leftover flash on recycle when the bind has no flash map", () => {
    const cell = makeCell();
    restartCellChangeFlash(cell);
    syncCellChangeFlash(cell, {
      column: { field: "name", cellChangeFlash: true },
      wasBoundToSameCell: false,
      flashFields: undefined,
      prevDisplay: "Alice",
      nextDisplay: "Bob",
    });
    expect(cell.element.classList.contains(CSS.CELL_CHANGE_FLASH)).toBe(false);
    expect(cell.flashAnim).toBeUndefined();
  });

  it("does not flash a rebound derived column from the flash map alone", () => {
    const cell = makeCell();
    const column: ColumnDef = {
      field: "label",
      cellChangeFlash: true,
      valueGetter: ({ row }) => String(row.name).toUpperCase(),
    };
    syncCellChangeFlash(cell, {
      column,
      wasBoundToSameCell: false,
      flashFields: new Set(["name"]),
      prevDisplay: "BOB",
      nextDisplay: "ALICIA",
    });
    expect(cell.element.classList.contains(CSS.CELL_CHANGE_FLASH)).toBe(false);
  });

  it("flashes ordinary fields from dirty metadata and skips unrelated fields", () => {
    const name = makeCell();
    name.value = "Alice";
    syncCellChangeFlash(name, {
      column: { field: "name", cellChangeFlash: true },
      wasBoundToSameCell: true,
      flashFields: new Set(["score"]),
      prevDisplay: "Alice",
      nextDisplay: "Alice",
    });
    expect(name.element.classList.contains(CSS.CELL_CHANGE_FLASH)).toBe(false);

    syncCellChangeFlash(name, {
      column: { field: "name", cellChangeFlash: true },
      wasBoundToSameCell: true,
      flashFields: new Set(["name"]),
      prevDisplay: "Alice",
      nextDisplay: "Alicia",
    });
    expect(name.element.classList.contains(CSS.CELL_CHANGE_FLASH)).toBe(true);
  });

  it("matches dirty prefix fields for dot-path columns", () => {
    const cell = makeCell();
    cell.value = "Alice";
    syncCellChangeFlash(cell, {
      column: { field: "user.name", cellChangeFlash: true },
      wasBoundToSameCell: true,
      flashFields: new Set(["user"]),
      prevDisplay: "Alice",
      nextDisplay: "Alicia",
    });
    expect(cell.element.classList.contains(CSS.CELL_CHANGE_FLASH)).toBe(true);
  });

  it("flashes derived columns only when bound display text changes", () => {
    const cell = makeCell();
    cell.value = "ALICE";
    const column: ColumnDef = {
      field: "label",
      cellChangeFlash: true,
      valueGetter: ({ row }) => String(row.name).toUpperCase(),
    };
    syncCellChangeFlash(cell, {
      column,
      wasBoundToSameCell: true,
      flashFields: new Set(["score"]),
      prevDisplay: "ALICE",
      nextDisplay: "ALICE",
    });
    expect(cell.element.classList.contains(CSS.CELL_CHANGE_FLASH)).toBe(false);

    syncCellChangeFlash(cell, {
      column,
      wasBoundToSameCell: true,
      flashFields: new Set(["name"]),
      prevDisplay: "ALICE",
      nextDisplay: "ALICIA",
    });
    expect(cell.element.classList.contains(CSS.CELL_CHANGE_FLASH)).toBe(true);
  });

  it("clears flash from every lane on a pooled row", () => {
    const row = makePoolRow();
    const pinned = makeCell();
    row.pinnedCells = [pinned];
    restartCellChangeFlash(row.cells[0]!);
    restartCellChangeFlash(pinned);
    clearRowCellChangeFlashes(row);
    expect(row.cells[0]!.flashAnim).toBeUndefined();
    expect(pinned.flashAnim).toBeUndefined();
  });

  it("recognizes flash keyframe names", () => {
    expect(isCellChangeFlashAnimationName("lfg-cell-change-flash-a")).toBe(true);
    expect(isCellChangeFlashAnimationName("lfg-cell-change-flash-b")).toBe(true);
    expect(isCellChangeFlashAnimationName("other")).toBe(false);
  });

  it("clears only the matching generation on animationend", () => {
    const cell = makeCell();
    cell.element.className = `${CSS.CELL} ${CSS.CELL_CHANGE_FLASH} ${CSS.CELL_CHANGE_FLASH_B}`;
    tryClearCellChangeFlashOnAnimationEnd(cell.element, "lfg-cell-change-flash-a");
    expect(cell.element.classList.contains(CSS.CELL_CHANGE_FLASH_B)).toBe(true);

    tryClearCellChangeFlashOnAnimationEnd(cell.element, "lfg-cell-change-flash-b");
    expect(cell.element.classList.contains(CSS.CELL_CHANGE_FLASH)).toBe(false);
  });

  it("ignores descendant and unrelated animationend targets", () => {
    const cell = makeCell();
    cell.element.className = `${CSS.CELL} ${CSS.CELL_CHANGE_FLASH} ${CSS.CELL_CHANGE_FLASH_A}`;
    const child = document.createElement("span");
    child.className = CSS.CELL_VALUE;
    cell.element.appendChild(child);

    tryClearCellChangeFlashOnAnimationEnd(child, "lfg-cell-change-flash-a");
    expect(cell.element.classList.contains(CSS.CELL_CHANGE_FLASH_A)).toBe(true);

    tryClearCellChangeFlashOnAnimationEnd(cell.element, "other-animation");
    expect(cell.element.classList.contains(CSS.CELL_CHANGE_FLASH_A)).toBe(true);

    tryClearCellChangeFlashOnAnimationEnd(null, "lfg-cell-change-flash-a");
    expect(cell.element.classList.contains(CSS.CELL_CHANGE_FLASH_A)).toBe(true);
  });
});

describe("populateRow cell-change flash bind rules", () => {
  const columns: ColumnDef[] = [
    { field: "name", cellChangeFlash: true },
    { field: "score", cellChangeFlash: true },
  ];
  const window: ColumnWindow = {
    startIndex: 0,
    slotCount: 2,
    toPhysicalCol: (v) => v,
  };
  const alice: RowData = { id: "a", name: "Alice", score: 10 };
  const bob: RowData = { id: "b", name: "Bob", score: 20 };

  function opts(overrides: Partial<PopulateRowOptions> = {}): PopulateRowOptions {
    return {
      dataRevision: 1,
      columnVersion: 1,
      getRowId: (row) => String(row.id),
      ...overrides,
    };
  }

  it("flashes a rebound pooled cell when the one-shot flash map targets that row", () => {
    const poolRow = makePoolRow();
    populateRow(poolRow, bob, columns, 1, window, opts({ dataRevision: 1 }));
    populateRow(poolRow, { id: "a", name: "Alicia", score: 10 }, columns, 0, window, opts({
      dataRevision: 2,
      flashRows: new Map([["a", new Set(["name"])]]),
    }));
    expect(poolRow.rowId).toBe("a");
    expect(poolRow.cells[0]!.element.classList.contains(CSS.CELL_CHANGE_FLASH)).toBe(true);
    expect(poolRow.cells[1]!.element.classList.contains(CSS.CELL_CHANGE_FLASH)).toBe(false);
  });

  it("flashes an in-place update of the same bound cell", () => {
    const poolRow = makePoolRow();
    populateRow(poolRow, alice, columns, 0, window, opts({ dataRevision: 1 }));
    populateRow(poolRow, { id: "a", name: "Alicia", score: 10 }, columns, 0, window, opts({
      dataRevision: 2,
      flashRows: new Map([["a", new Set(["name"])]]),
    }));
    expect(poolRow.cells[0]!.element.classList.contains(CSS.CELL_CHANGE_FLASH)).toBe(true);
    expect(poolRow.cells[1]!.element.classList.contains(CSS.CELL_CHANGE_FLASH)).toBe(false);
  });

  it("clears leftover flash when the slot is recycled to another row", () => {
    const poolRow = makePoolRow();
    populateRow(poolRow, alice, columns, 0, window, opts({ dataRevision: 1 }));
    populateRow(poolRow, { id: "a", name: "Alicia", score: 10 }, columns, 0, window, opts({
      dataRevision: 2,
      flashRows: new Map([["a", new Set(["name"])]]),
    }));
    expect(poolRow.cells[0]!.element.classList.contains(CSS.CELL_CHANGE_FLASH)).toBe(true);

    populateRow(poolRow, bob, columns, 1, window, opts({
      dataRevision: 3,
      flashRows: new Map([["a", new Set(["name"])]]),
    }));
    expect(poolRow.rowId).toBe("b");
    expect(poolRow.cells[0]!.element.classList.contains(CSS.CELL_CHANGE_FLASH)).toBe(false);
  });
});
