// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import type { ColumnDef, PooledCell, PooledRow, RowData } from "../../../types";
import { CSS } from "../../const/css-classes";
import {
  type ColumnWindow,
  populateRow,
} from "../populateRow";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function cellText(
  container: HTMLElement,
  rowIndex: number,
  field: string,
): string {
  const cell = container.querySelector(
    `.${CSS.ROW}[data-row-index="${rowIndex}"] .${CSS.CELL}[data-col-id="${field}"]`,
  );
  return cell?.textContent ?? "";
}

describe("cell value pipeline (getter → formatter → text)", () => {
  it("A. valueGetter displays computed value", async () => {
    const columns: ColumnDef[] = [
      { field: "first", width: 80 },
      {
        field: "fullName",
        width: 120,
        valueGetter: ({ row }) => `${row.first} ${row.last}`,
      },
    ];
    const rows: RowData[] = [
      { id: "1", first: "Jane", last: "Doe" } as RowData,
    ];

    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows,
      columns,
      getRowId: (row) => (row as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    expect(cellText(container, 0, "fullName")).toBe("Jane Doe");

    grid.destroy();
    container.remove();
  });

  it("B. valueFormatter formats raw field value", async () => {
    const columns: ColumnDef[] = [
      {
        field: "price",
        width: 120,
        valueFormatter: ({ value }) => `$${value}`,
      },
    ];
    const rows: RowData[] = [{ id: "1", price: 5 } as RowData];

    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "320px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows,
      columns,
      getRowId: (row) => (row as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    expect(cellText(container, 0, "price")).toBe("$5");

    grid.destroy();
    container.remove();
  });

  it("C. valueGetter runs before valueFormatter (formatter sees getter output)", async () => {
    const columns: ColumnDef[] = [
      {
        field: "units",
        width: 120,
        valueGetter: () => 10,
        valueFormatter: ({ value }) => {
          expect(value).toBe(10);
          return `${value} units`;
        },
      },
    ];
    const rows: RowData[] = [{ id: "1", units: 0 } as RowData];

    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "320px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows,
      columns,
      getRowId: (row) => (row as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    expect(cellText(container, 0, "units")).toBe("10 units");

    grid.destroy();
    container.remove();
  });

  it("D. null / undefined display as empty string without formatter", async () => {
    const columns: ColumnDef[] = [{ field: "x", width: 120 }];
    const rows: RowData[] = [
      { id: "1", x: null } as RowData,
      { id: "2" } as RowData,
    ];

    const container = document.createElement("div");
    Object.assign(container.style, { height: "240px", width: "320px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows,
      columns,
      getRowId: (row) => (row as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    expect(cellText(container, 0, "x")).toBe("");
    expect(cellText(container, 1, "x")).toBe("");

    grid.destroy();
    container.remove();
  });

  it("E. horizontal rebind applies getter/formatter for newly visible column", async () => {
    const targetI = 40;
    const targetField = `m${targetI}`;
    const colCount = 80;
    const columns: ColumnDef[] = Array.from({ length: colCount }, (_, i) => ({
      field: `m${i}`,
      width: 100,
      ...(i === targetI
        ? {
            valueFormatter: ({ value }: { value: unknown }) => `F:${value}`,
          }
        : {}),
    }));
    const rows = Array.from({ length: 20 }, (_, r) => {
      const row: Record<string, unknown> = { id: `mr${r}` };
      for (let i = 0; i < colCount; i++) row[`m${i}`] = r;
      return row as RowData;
    });

    const container = document.createElement("div");
    Object.assign(container.style, { height: "280px", width: "350px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows,
      columns,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: false,
      getRowId: (row) => (row as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollLeft = 4000;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();
    await flushRenders();

    const cell = container.querySelector(
      `.${CSS.ROW}[data-row-index="0"] .${CSS.CELL}[data-col-id="${targetField}"]`,
    );
    expect(cell).toBeTruthy();
    expect(cell?.textContent).toBe("F:0");

    grid.destroy();
    container.remove();
  });

  it("F. layout-only populateRow does not re-run the value pipeline", () => {
    const formatter = vi.fn(() => "X");
    const col: ColumnDef = { field: "a", valueFormatter: formatter };
    const columns = [col];
    const row: RowData = { a: 1 };

    const element = document.createElement("div");
    element.className = CSS.CELL;
    element.setAttribute("data-col-id", "a");
    const cell: PooledCell = { element, value: "" };

    const rowEl = document.createElement("div");
    rowEl.className = CSS.ROW;
    rowEl.appendChild(element);

    const poolRow: PooledRow = {
      element: rowEl,
      cells: [cell],
      rowIndex: -1,
      rowVersion: -1,
      rowId: null,
    };

    const windowDef: ColumnWindow = {
      startIndex: 0,
      slotCount: 1,
      toPhysicalCol: (v) => v,
    };

    // Normal populate: formatter runs and cell gets the formatted value.
    populateRow(poolRow, row, columns, 0, windowDef, {
      layoutOnly: false,
      dataRevision: 1,
      columnVersion: 1,
    });
    expect(formatter.mock.calls.length).toBeGreaterThan(0);
    expect(cell.element.textContent).toBe("X");
    formatter.mockClear();

    // Layout-only populate: formatter must NOT run again.
    populateRow(poolRow, row, columns, 0, windowDef, {
      layoutOnly: true,
      dataRevision: 1,
      columnVersion: 1,
    });
    expect(formatter).not.toHaveBeenCalled();
    // Cell text unchanged — value pipeline was skipped.
    expect(cell.element.textContent).toBe("X");
  });
});
