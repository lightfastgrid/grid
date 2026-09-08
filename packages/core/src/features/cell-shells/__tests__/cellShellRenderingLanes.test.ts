// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { SELECTION_COLUMN_FIELD } from "../../../internal/selectionColumn";
import { CSS } from "../../../rendering/const/css-classes";
import {
  type ColumnWindow,
  populateRow,
  type PopulateRowOptions,
  rebindCells,
  syncPinnedRowCells,
} from "../../../rendering/helpers/populateRow";
import type { ColumnDef, PooledCell, PooledRow, RowData } from "../../../types";
import { ACTION_CELL_CLASS } from "../../row-actions/rowActionDom";

// ── Helpers ─────────────────────────────────────────────────────────

function makeCells(count: number): PooledCell[] {
  const cells: PooledCell[] = [];
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = CSS.CELL;
    cells.push({ element: el, value: "" });
  }
  return cells;
}

function makePoolRow(cellCount: number): PooledRow {
  const element = document.createElement("div");
  element.className = CSS.ROW;
  const cells = makeCells(cellCount);
  for (const c of cells) element.appendChild(c.element);
  return { element, cells, rowIndex: -1, rowVersion: 0, rowId: null };
}

function makePinnedPoolRow(pinnedCount: number, side: "left" | "right"): PooledRow {
  const element = document.createElement("div");
  element.className = CSS.ROW;
  const pinnedEl = document.createElement("div");
  pinnedEl.className = CSS.ROW;
  const pinnedCells = makeCells(pinnedCount);
  for (const c of pinnedCells) pinnedEl.appendChild(c.element);

  const row: PooledRow = {
    element, cells: [], rowIndex: -1, rowVersion: 0, rowId: null,
  };
  if (side === "left") {
    row.pinnedElement = pinnedEl;
    row.pinnedCells = pinnedCells;
  } else {
    row.rightPinnedElement = pinnedEl;
    row.rightPinnedCells = pinnedCells;
  }
  return row;
}

function win(slotCount: number): ColumnWindow {
  return { startIndex: 0, slotCount, toPhysicalCol: (v) => v };
}

function opts(overrides: Partial<PopulateRowOptions> = {}): PopulateRowOptions {
  return {
    dataRevision: 1,
    columnVersion: 1,
    getRowId: (row) => (row as { id: string }).id,
    ...overrides,
  };
}

const rowAlice: RowData = { id: "r1", name: "Alice", amount: 42 };
const rowBob: RowData = { id: "r2", name: "Bob", amount: -7 };
const getRowId = (r: RowData) => (r as { id: string }).id;

// ── Dirty-field skip awareness of cross-field shell dependencies ────

describe("populateRow: cellShell cross-field dirty dependency", () => {
  function shellLabel(cell: PooledCell): string | null | undefined {
    return cell.shellRoot?.querySelector(".lfg-cell-shell-label")?.textContent;
  }

  it("refreshes a shell reading text:{field} when only that field changes", () => {
    // Column field is "status", but the shell renders from "statusLabel".
    const cols: ColumnDef[] = [
      { field: "status", cellShell: { kind: "text", text: { field: "statusLabel" } } },
    ];
    const poolRow = makePoolRow(1);

    const row1: RowData = { id: "r1", status: "a", statusLabel: "Active" };
    populateRow(poolRow, row1, cols, 0, win(1), opts());
    const cell = poolRow.cells[0]!;
    expect(cell.shellKind).toBe("text");
    expect(shellLabel(cell)).toBe("Active");

    // Update-only transaction: the column's own field "status" is unchanged;
    // only "statusLabel" changed. The field-level dirty-skip must NOT fire
    // because the shell depends on statusLabel.
    const row2: RowData = { id: "r1", status: "a", statusLabel: "Archived" };
    populateRow(poolRow, row2, cols, 0, win(1), opts({
      dataRevision: 2,
      columnVersion: 1,
      changedRows: new Map([["r1", new Set(["statusLabel"])]]),
    }));

    expect(shellLabel(cell)).toBe("Archived");
  });

  it("still skips a shell that depends only on its own field", () => {
    // Own-field shell: dirty-skip is allowed when the own field is unchanged.
    const cols: ColumnDef[] = [{ field: "name", cellShell: "text" }];
    const poolRow = makePoolRow(1);

    const row1: RowData = { id: "r1", name: "Alice", other: 1 };
    populateRow(poolRow, row1, cols, 0, win(1), opts());
    const cell = poolRow.cells[0]!;
    expect(shellLabel(cell)).toBe("Alice");

    // Only an unrelated field changed; the own-field shell keeps its value
    // (the cell is skipped, so even a mutated "name" here would not re-read).
    const row2: RowData = { id: "r1", name: "Bob", other: 2 };
    populateRow(poolRow, row2, cols, 0, win(1), opts({
      dataRevision: 2,
      columnVersion: 1,
      changedRows: new Map([["r1", new Set(["other"])]]),
    }));

    expect(shellLabel(cell)).toBe("Alice");
  });
});

// ── Mode transitions (same field) ───────────────────────────────────

describe("populateRow → cell shell mode transitions", () => {
  it("plain text → shell: clears stale textContent before mounting shell", () => {
    const cols: ColumnDef[] = [{ field: "name" }];
    const poolRow = makePoolRow(1);

    populateRow(poolRow, rowAlice, cols, 0, win(1), opts());
    expect(poolRow.cells[0]!.element.textContent).toBe("Alice");
    expect(poolRow.cells[0]!.shellKind).toBeUndefined();

    const shellCols: ColumnDef[] = [{ field: "name", cellShell: "badge" }];
    populateRow(poolRow, rowBob, shellCols, 1, win(1), opts({
      dataRevision: 2, columnVersion: 2,
    }));

    const cell = poolRow.cells[0]!;
    expect(cell.shellKind).toBe("badge");
    expect(cell.shellRoot).toBeDefined();
    expect(cell.element.childNodes.length).toBe(1);
    expect(cell.element.childNodes[0]).toBe(cell.shellRoot);
  });

  it("shell → plain text: restores textContent even when value is unchanged", () => {
    const shellCols: ColumnDef[] = [{ field: "name", cellShell: "badge" }];
    const plainCols: ColumnDef[] = [{ field: "name" }];
    const poolRow = makePoolRow(1);

    populateRow(poolRow, rowAlice, shellCols, 0, win(1), opts());
    const cell = poolRow.cells[0]!;
    expect(cell.shellKind).toBe("badge");
    expect(cell.value).toBe("Alice");

    populateRow(poolRow, rowAlice, plainCols, 0, win(1), opts({
      dataRevision: 2, columnVersion: 2,
    }));

    expect(cell.shellKind).toBeUndefined();
    expect(cell.shellRoot).toBeUndefined();
    expect(cell.element.textContent).toBe("Alice");
    expect(cell.element.children.length).toBe(1);
    expect(cell.element.querySelector(".lfg-cell-value")?.textContent).toBe("Alice");
  });
});

// ── Pinned lane shell rendering ─────────────────────────────────────

describe("syncPinnedRowCells → cell shells", () => {
  it("renders cellShell in pinned-left body cells", () => {
    const cols: ColumnDef[] = [{ field: "name", cellShell: "badge" }];
    const poolRow = makePinnedPoolRow(1, "left");

    syncPinnedRowCells(poolRow, rowAlice, cols, 0, getRowId);

    const cell = poolRow.pinnedCells![0]!;
    expect(cell.shellKind).toBe("badge");
    expect(cell.shellRoot).toBeDefined();
    expect(cell.shellRoot!.className).toContain("lfg-cell-shell-badge");
    expect(cell.shellRoot!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Alice");
  });

  it("preserves named widget semantics in pinned-left and pinned-right cells", () => {
    const left = makePinnedPoolRow(1, "left");
    syncPinnedRowCells(
      left,
      rowAlice,
      [{
        field: "name",
        cellShell: {
          kind: "button",
          text: { literal: "Edit Alice" },
          actionKey: "edit",
        },
      }],
      0,
      getRowId,
    );
    const leftButton = left.pinnedCells![0]!.shellRoot as HTMLButtonElement;
    expect(leftButton.tagName).toBe("BUTTON");
    expect(leftButton.tabIndex).toBe(-1);
    expect(leftButton.getAttribute("aria-label")).toBe("Edit Alice");

    const right = makePinnedPoolRow(1, "right");
    syncPinnedRowCells(
      right,
      rowAlice,
      [{
        field: "name",
        cellShell: {
          kind: "link",
          text: { literal: "Open Alice" },
          actionKey: "open",
        },
      }],
      0,
      getRowId,
      undefined,
      undefined,
      "right",
    );
    const rightLink = right.rightPinnedCells![0]!.shellRoot!;
    expect(rightLink.getAttribute("role")).toBe("link");
    expect(rightLink.tabIndex).toBe(-1);
    expect(rightLink.getAttribute("aria-label")).toBe("Open Alice");
  });

  it("renders cellShell in pinned-right body cells", () => {
    const cols: ColumnDef[] = [{ field: "amount", cellShell: "progress" }];
    const poolRow = makePinnedPoolRow(1, "right");

    syncPinnedRowCells(poolRow, rowAlice, cols, 0, getRowId, undefined, undefined, "right");

    const cell = poolRow.rightPinnedCells![0]!;
    expect(cell.shellKind).toBe("progress");
    expect(cell.shellRoot).toBeDefined();
    expect(cell.shellRoot!.className).toContain("lfg-cell-shell-progress");
  });

  it("clears shell when pinned column drops cellShell", () => {
    const shellCols: ColumnDef[] = [{ field: "name", cellShell: "badge" }];
    const plainCols: ColumnDef[] = [{ field: "name" }];
    const poolRow = makePinnedPoolRow(1, "left");

    syncPinnedRowCells(poolRow, rowAlice, shellCols, 0, getRowId);
    expect(poolRow.pinnedCells![0]!.shellKind).toBe("badge");

    syncPinnedRowCells(poolRow, rowAlice, plainCols, 0, getRowId);
    const cell = poolRow.pinnedCells![0]!;
    expect(cell.shellKind).toBeUndefined();
    expect(cell.shellRoot).toBeUndefined();
    expect(cell.element.textContent).toBe("Alice");
  });
});

// ── rebindCells shell rendering ─────────────────────────────────────

describe("rebindCells → cell shells", () => {
  it("renders shell DOM for newly visible shell columns", () => {
    const cols: ColumnDef[] = [
      { field: "name" },
      { field: "amount", cellShell: "progress" },
    ];
    const poolRow = makePoolRow(2);

    populateRow(poolRow, rowAlice, cols, 0, win(1), opts());
    expect(poolRow.cells[1]!.shellKind).toBeUndefined();

    rebindCells(poolRow, rowAlice, cols, 0, 0, [1], (v) => v, getRowId);

    const cell = poolRow.cells[1]!;
    expect(cell.shellKind).toBe("progress");
    expect(cell.shellRoot).toBeDefined();
    expect(cell.shellRoot!.className).toContain("lfg-cell-shell-progress");
  });

  it("clears shell on rebind when column drops cellShell", () => {
    const shellCols: ColumnDef[] = [{ field: "name", cellShell: "badge" }];
    const plainCols: ColumnDef[] = [{ field: "name" }];
    const poolRow = makePoolRow(1);

    populateRow(poolRow, rowAlice, shellCols, 0, win(1), opts());
    expect(poolRow.cells[0]!.shellKind).toBe("badge");

    rebindCells(poolRow, rowAlice, plainCols, 0, 0, [0], (v) => v, getRowId);

    const cell = poolRow.cells[0]!;
    expect(cell.shellKind).toBeUndefined();
    expect(cell.shellRoot).toBeUndefined();
    expect(cell.element.textContent).toBe("Alice");
  });
});

// ── Shell → non-data cell cleanup regressions ───────────────────────

describe("shell data cell → action cell cleanup", () => {
  const actionCol: ColumnDef = { field: "__actions__", cellKind: "actions" };

  it("clears shell bookkeeping when recycling to an action cell", () => {
    const shellCols: ColumnDef[] = [{ field: "name", cellShell: "badge" }];
    const poolRow = makePoolRow(1);

    populateRow(poolRow, rowAlice, shellCols, 0, win(1), opts());
    const cell = poolRow.cells[0]!;
    expect(cell.shellKind).toBe("badge");
    expect(cell.shellRoot).toBeDefined();

    const actionCols: ColumnDef[] = [actionCol];
    populateRow(poolRow, rowAlice, actionCols, 0, win(1), opts({
      dataRevision: 2, columnVersion: 2,
    }));

    expect(cell.shellKind).toBeUndefined();
    expect(cell.shellRoot).toBeUndefined();
    expect(cell.shellClassNames).toBeUndefined();
    expect(cell.shellActionKey).toBeUndefined();
  });

  it("shell → action → shell with same field renders fresh shell DOM", () => {
    const shellCols: ColumnDef[] = [{ field: "name", cellShell: "badge" }];
    const actionCols: ColumnDef[] = [actionCol];
    const poolRow = makePoolRow(1);

    // Phase 1: shell cell
    populateRow(poolRow, rowAlice, shellCols, 0, win(1), opts());
    const cell = poolRow.cells[0]!;
    const firstRoot = cell.shellRoot;
    expect(cell.shellKind).toBe("badge");

    // Phase 2: action cell
    populateRow(poolRow, rowAlice, actionCols, 0, win(1), opts({
      dataRevision: 2, columnVersion: 2,
    }));
    expect(cell.shellKind).toBeUndefined();

    // Phase 3: back to shell cell with same field
    populateRow(poolRow, rowBob, shellCols, 1, win(1), opts({
      dataRevision: 3, columnVersion: 3,
    }));
    expect(cell.shellKind).toBe("badge");
    expect(cell.shellRoot).toBeDefined();
    expect(cell.shellRoot).not.toBe(firstRoot);
    expect(cell.element.contains(cell.shellRoot!)).toBe(true);
    expect(cell.shellRoot!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Bob");
  });
});

describe("shell data cell → selection cell cleanup", () => {
  const selCol: ColumnDef = {
    field: SELECTION_COLUMN_FIELD,
    internal: "selection" as ColumnDef["internal"],
  };

  it("clears shell bookkeeping and resets cell value when recycling to a selection cell", () => {
    const shellCols: ColumnDef[] = [{ field: "name", cellShell: "badge" }];
    const poolRow = makePoolRow(1);

    populateRow(poolRow, rowAlice, shellCols, 0, win(1), opts());
    const cell = poolRow.cells[0]!;
    expect(cell.shellKind).toBe("badge");
    expect(cell.value).toBe("Alice");

    const selCols: ColumnDef[] = [selCol];
    populateRow(poolRow, rowAlice, selCols, 0, win(1), opts({
      dataRevision: 2, columnVersion: 2,
    }));

    expect(cell.shellKind).toBeUndefined();
    expect(cell.shellRoot).toBeUndefined();
    expect(cell.value).toBe("");
    const input = cell.element.querySelector<HTMLInputElement>(
      ".lfg-row-selection-checkbox",
    );
    expect(input?.type).toBe("checkbox");
    expect(input?.tabIndex).toBe(-1);
    expect(input?.getAttribute("aria-label")).toBe("Select row");
  });
});

describe("shell data cell → internal/hidden cell cleanup", () => {
  // Use a non-"selection" internal value to hit the hidden/internal fallback
  // path rather than the selection column path.
  const internalCol = {
    field: "__internal__",
    internal: "synthetic",
  } as unknown as ColumnDef;

  it("clears shell bookkeeping and resets cell value when hidden for internal column", () => {
    const shellCols: ColumnDef[] = [{ field: "name", cellShell: "badge" }];
    const poolRow = makePoolRow(1);

    populateRow(poolRow, rowAlice, shellCols, 0, win(1), opts());
    const cell = poolRow.cells[0]!;
    expect(cell.shellKind).toBe("badge");
    expect(cell.value).toBe("Alice");

    const internalCols: ColumnDef[] = [internalCol];
    populateRow(poolRow, rowAlice, internalCols, 0, win(1), opts({
      dataRevision: 2, columnVersion: 2,
    }));

    expect(cell.shellKind).toBeUndefined();
    expect(cell.shellRoot).toBeUndefined();
    expect(cell.value).toBe("");
  });
});

// ── Shell → hidden/out-of-range → plain text restore ────────────────

describe("populateRow: shell → hidden → plain text restores textContent", () => {
  it("shell hidden by out-of-range then re-shown as plain text restores value", () => {
    const shellCols: ColumnDef[] = [{ field: "name", cellShell: "badge" }];
    const plainCols: ColumnDef[] = [{ field: "name" }];
    const poolRow = makePoolRow(1);

    // Phase 1: shell cell
    populateRow(poolRow, rowAlice, shellCols, 0, win(1), opts());
    const cell = poolRow.cells[0]!;
    expect(cell.shellKind).toBe("badge");
    expect(cell.value).toBe("Alice");

    // Phase 2: hide cell via empty column list (out of range)
    populateRow(poolRow, rowBob, [], 1, win(1), opts({
      dataRevision: 2, columnVersion: 2,
    }));
    expect(cell.shellKind).toBeUndefined();
    expect(cell.value).toBe("");

    // Phase 3: re-show as plain text with same field
    populateRow(poolRow, rowBob, plainCols, 1, win(1), opts({
      dataRevision: 3, columnVersion: 3,
    }));
    expect(cell.shellKind).toBeUndefined();
    expect(cell.element.textContent).toBe("Bob");
    expect(cell.value).toBe("Bob");
  });
});

describe("rebindCells: shell → hidden → plain text restores textContent", () => {
  it("shell hidden by out-of-range then re-shown as plain text restores value", () => {
    const shellCols: ColumnDef[] = [{ field: "name", cellShell: "badge" }];
    const plainCols: ColumnDef[] = [{ field: "name" }];
    const poolRow = makePoolRow(1);

    // Phase 1: shell cell via populateRow
    populateRow(poolRow, rowAlice, shellCols, 0, win(1), opts());
    const cell = poolRow.cells[0]!;
    expect(cell.shellKind).toBe("badge");
    expect(cell.value).toBe("Alice");

    // Phase 2: rebind to out-of-range (empty columns)
    rebindCells(poolRow, rowAlice, [], 0, 0, [0], (v) => v, getRowId);
    expect(cell.shellKind).toBeUndefined();
    expect(cell.value).toBe("");

    // Phase 3: rebind back as plain text
    rebindCells(poolRow, rowAlice, plainCols, 0, 0, [0], (v) => v, getRowId);
    expect(cell.shellKind).toBeUndefined();
    expect(cell.element.textContent).toBe("Alice");
    expect(cell.value).toBe("Alice");
  });
});

describe("same-field action chrome cleanup in bindDataCellValue", () => {
  const sameFieldActionCol: ColumnDef = { field: "name", cellKind: "actions" };

  it("action col → shell col (same field) removes ACTION_CELL_CLASS and renders shell", () => {
    const poolRow = makePoolRow(1);

    // Phase 1: bind as action cell with field "name"
    populateRow(poolRow, rowAlice, [sameFieldActionCol], 0, win(1), opts());
    const cell = poolRow.cells[0]!;
    expect(cell.element.classList.contains(ACTION_CELL_CLASS)).toBe(true);

    // Phase 2: bind as shell cell with same field "name"
    const shellCols: ColumnDef[] = [{ field: "name", cellShell: "badge" }];
    populateRow(poolRow, rowBob, shellCols, 1, win(1), opts({
      dataRevision: 2, columnVersion: 2,
    }));

    expect(cell.element.classList.contains(ACTION_CELL_CLASS)).toBe(false);
    expect(cell.shellKind).toBe("badge");
    expect(cell.shellRoot).toBeDefined();
    expect(cell.shellRoot!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Bob");
  });

  it("action col → plain col (same field) removes ACTION_CELL_CLASS and restores text", () => {
    const poolRow = makePoolRow(1);

    // Phase 1: bind as action cell with field "name"
    populateRow(poolRow, rowAlice, [sameFieldActionCol], 0, win(1), opts());
    const cell = poolRow.cells[0]!;
    expect(cell.element.classList.contains(ACTION_CELL_CLASS)).toBe(true);

    // Phase 2: bind as plain text cell with same field "name"
    const plainCols: ColumnDef[] = [{ field: "name" }];
    populateRow(poolRow, rowBob, plainCols, 1, win(1), opts({
      dataRevision: 2, columnVersion: 2,
    }));

    expect(cell.element.classList.contains(ACTION_CELL_CLASS)).toBe(false);
    expect(cell.shellKind).toBeUndefined();
    expect(cell.element.textContent).toBe("Bob");
    expect(cell.value).toBe("Bob");
  });

  it("shell → action → shell (same field) renders fresh shell without ACTION_CELL_CLASS", () => {
    const shellCols: ColumnDef[] = [{ field: "name", cellShell: "badge" }];
    const poolRow = makePoolRow(1);

    // Phase 1: shell cell
    populateRow(poolRow, rowAlice, shellCols, 0, win(1), opts());
    const cell = poolRow.cells[0]!;
    const firstRoot = cell.shellRoot;
    expect(cell.shellKind).toBe("badge");

    // Phase 2: action cell with same field
    populateRow(poolRow, rowAlice, [sameFieldActionCol], 0, win(1), opts({
      dataRevision: 2, columnVersion: 2,
    }));
    expect(cell.element.classList.contains(ACTION_CELL_CLASS)).toBe(true);
    expect(cell.shellKind).toBeUndefined();

    // Phase 3: back to shell cell with same field
    populateRow(poolRow, rowBob, shellCols, 1, win(1), opts({
      dataRevision: 3, columnVersion: 3,
    }));
    expect(cell.element.classList.contains(ACTION_CELL_CLASS)).toBe(false);
    expect(cell.shellKind).toBe("badge");
    expect(cell.shellRoot).toBeDefined();
    expect(cell.shellRoot).not.toBe(firstRoot);
    expect(cell.shellRoot!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Bob");
  });
});

describe("rebindCells → shell cleanup on non-data recycle", () => {
  const actionCol: ColumnDef = { field: "__actions__", cellKind: "actions" };

  it("clears shell when rebinding into an action column", () => {
    const shellCols: ColumnDef[] = [{ field: "name", cellShell: "badge" }];
    const poolRow = makePoolRow(1);

    populateRow(poolRow, rowAlice, shellCols, 0, win(1), opts());
    expect(poolRow.cells[0]!.shellKind).toBe("badge");

    rebindCells(
      poolRow, rowAlice, [actionCol], 0, 0,
      [0], (v) => v, getRowId,
    );

    const cell = poolRow.cells[0]!;
    expect(cell.shellKind).toBeUndefined();
    expect(cell.shellRoot).toBeUndefined();
  });

  it("still renders shells after cleanup in a subsequent rebind", () => {
    const shellCols: ColumnDef[] = [{ field: "name", cellShell: "badge" }];
    const poolRow = makePoolRow(1);

    // Initial shell bind
    populateRow(poolRow, rowAlice, shellCols, 0, win(1), opts());
    expect(poolRow.cells[0]!.shellKind).toBe("badge");

    // Rebind to action → clears shell
    rebindCells(
      poolRow, rowAlice, [actionCol], 0, 0,
      [0], (v) => v, getRowId,
    );
    expect(poolRow.cells[0]!.shellKind).toBeUndefined();

    // Rebind back to shell column → renders fresh shell
    rebindCells(
      poolRow, rowAlice, shellCols, 0, 0,
      [0], (v) => v, getRowId,
    );

    const cell = poolRow.cells[0]!;
    expect(cell.shellKind).toBe("badge");
    expect(cell.shellRoot).toBeDefined();
    expect(cell.element.contains(cell.shellRoot!)).toBe(true);
    expect(cell.shellRoot!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Alice");
  });
});
