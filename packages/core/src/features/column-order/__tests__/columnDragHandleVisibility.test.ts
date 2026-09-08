// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { Grid } from "../../../Grid";
import type { RowData } from "../../../types";
import { COLUMN_ORDER_ENABLED_CLASS } from "../ColumnOrderController";

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

describe("column drag handle visibility", () => {
  it("does not keep a drag handle when reorderable is false", async () => {
    const rows: RowData[] = [{ id: "1", a: "x", b: "y" }];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const grid = new Grid({
      rows,
      columns: [
        { field: "a", width: 100, reorderable: false, columnMenu: false },
        { field: "b", width: 100, reorderable: true },
      ],
      columnOrder: { enabled: true },
      getRowId: (r) => String(r.id),
    });
    grid.mount(container);
    await flush();

    expect(
      container.querySelector('.lfg-column-drag-handle[data-col-id="a"]'),
    ).toBeNull();
    expect(
      container.querySelector('.lfg-column-drag-handle[data-col-id="b"]'),
    ).toBeTruthy();
    expect(
      container.querySelector(".lfg-grid")?.classList.contains(
        COLUMN_ORDER_ENABLED_CLASS,
      ),
    ).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("does not enable column-order chrome when columnOrder is false", async () => {
    const rows: RowData[] = [{ id: "1", a: "x", b: "y" }];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const grid = new Grid({
      rows,
      columns: [
        { field: "a", width: 100 },
        { field: "b", width: 100 },
      ],
      columnOrder: false,
      getRowId: (r) => String(r.id),
    });
    grid.mount(container);
    await flush();

    const root = container.querySelector(".lfg-grid");
    expect(root?.classList.contains(COLUMN_ORDER_ENABLED_CLASS)).toBe(false);

    grid.setColumnOrder({ enabled: true });
    await flush();
    expect(root?.classList.contains(COLUMN_ORDER_ENABLED_CLASS)).toBe(true);

    grid.setColumnOrder(false);
    await flush();
    expect(root?.classList.contains(COLUMN_ORDER_ENABLED_CLASS)).toBe(false);

    grid.destroy();
    container.remove();
  });
});
