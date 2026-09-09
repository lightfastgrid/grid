// @vitest-environment jsdom
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { createRef, type RefObject, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@lightfastgrid/core", async () => import("../../../core/src/index"));

import type { RowDataTransactionResult } from "@lightfastgrid/core";

import { LightFastGrid } from "../LightFastGrid";
import type { ReactLightFastGridHandle } from "../types";

const FLASH_CLASS = "lfg-cell-change-flash";
const FLASH_B_CLASS = "lfg-cell-change-flash-b";

type OrderRow = {
  id: string;
  customer: string;
  status: string;
  units: number;
};

const INITIAL_ROWS: OrderRow[] = [
  { id: "order-1001", customer: "Acme GmbH", status: "Processing", units: 24 },
  { id: "order-1002", customer: "Globex Corporation", status: "Ready", units: 48 },
];

function getRowId(row: { id?: unknown }) {
  return String(row.id);
}

function cell(
  container: HTMLElement,
  rowId: string,
  field: string,
): HTMLElement | null {
  const cells = container.querySelectorAll(`.lfg-cell[data-col-id="${field}"]`);
  for (const candidate of cells) {
    const row = candidate.closest("[data-row-id]");
    if (row?.getAttribute("data-row-id") === rowId) {
      return candidate as HTMLElement;
    }
  }
  return null;
}

function isFlashing(el: HTMLElement | null): boolean {
  return !!el?.classList.contains(FLASH_CLASS);
}

async function flushGridRenders(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}

type HarnessApi = {
  applyOne(echo?: "identity" | "slice"): void;
  applyAsyncOne(): void;
  replaceAuthoritativeSnapshot(): void;
  bumpUnrelated(): void;
};

function FlashSyncHarness({
  apiRef,
  gridRef,
  immutableRows,
}: {
  apiRef: { current: HarnessApi | null };
  gridRef: RefObject<ReactLightFastGridHandle | null>;
  immutableRows: boolean;
}) {
  const [rows, setRows] = useState(() => INITIAL_ROWS.map((row) => ({ ...row })));
  const [unrelated, setUnrelated] = useState(0);

  apiRef.current = {
    applyOne(echo = "identity") {
      const grid = gridRef.current;
      if (!grid) return;
      const current = grid.getRows() as OrderRow[];
      const target = current.find((row) => row.id === "order-1001");
      if (!target) return;
      const result = grid.applyTransaction({
        update: [
          {
            ...target,
            customer: "Acme GmbH · live",
            status: "Ready",
            units: 31,
          },
        ],
      });
      const accepted = result.rows as OrderRow[];
      setRows(echo === "slice" ? accepted.slice() : accepted);
    },
    applyAsyncOne() {
      const grid = gridRef.current;
      if (!grid) return;
      const current = grid.getRows() as OrderRow[];
      const target = current.find((row) => row.id === "order-1002");
      if (!target) return;
      grid.applyTransactionAsync(
        {
          update: [
            {
              ...target,
              customer: "Globex Corporation · live",
              status: "Shipped",
              units: 55,
            },
          ],
        },
        (result: RowDataTransactionResult) => {
          setRows(result.rows as OrderRow[]);
        },
      );
      grid.flushAsyncTransactions();
    },
    replaceAuthoritativeSnapshot() {
      setRows((current) =>
        current.map((row) =>
          row.id === "order-1001"
            ? { ...row, customer: "Replacement GmbH", status: "Shipped", units: 99 }
            : { ...row },
        ),
      );
    },
    bumpUnrelated() {
      setUnrelated((value) => value + 1);
    },
  };

  return (
    <div style={{ height: 240, width: 640 }}>
      <span data-unrelated={unrelated} />
      <LightFastGrid
        ref={gridRef}
        rows={rows}
        columns={[
          { field: "customer", cellChangeFlash: false, width: 180 },
          { field: "status", width: 120 },
          { field: "units", width: 100 },
        ]}
        defaultColDef={{ cellChangeFlash: true }}
        getRowId={getRowId}
        immutableRows={immutableRows}
        height="100%"
        suppressRowVirtualization
        suppressColumnVirtualization
      />
    </div>
  );
}

describe("React cell-change flash row synchronization", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    if (root && container) {
      const mountedRoot = root;
      const mountedContainer = container;
      await act(async () => {
        mountedRoot.unmount();
      });
      mountedContainer.remove();
    }
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  async function mountHarness(immutableRows = true) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const gridRef = createRef<ReactLightFastGridHandle>();
    const apiRef: { current: HarnessApi | null } = { current: null };
    await act(async () => {
      root!.render(
        <FlashSyncHarness
          apiRef={apiRef}
          gridRef={gridRef}
          immutableRows={immutableRows}
        />,
      );
    });
    await flushGridRenders();
    return { apiRef, gridRef };
  }

  function expectOrder1001FlashAndCustomerOptOut() {
    expect(cell(container!, "order-1001", "customer")!.textContent).toBe(
      "Acme GmbH · live",
    );
    expect(cell(container!, "order-1001", "status")!.textContent).toBe("Ready");
    expect(cell(container!, "order-1001", "units")!.textContent).toBe("31");
    expect(isFlashing(cell(container!, "order-1001", "customer"))).toBe(false);
    expect(isFlashing(cell(container!, "order-1001", "status"))).toBe(true);
    expect(isFlashing(cell(container!, "order-1001", "units"))).toBe(true);
  }

  it("keeps flash after echoing accepted transaction rows through React state", async () => {
    const { apiRef, gridRef } = await mountHarness();

    await act(async () => {
      apiRef.current?.applyOne();
    });
    await flushGridRenders();
    expectOrder1001FlashAndCustomerOptOut();

    await act(async () => {
      apiRef.current?.bumpUnrelated();
    });
    await flushGridRenders();

    expect(gridRef.current?.getRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "order-1001",
          customer: "Acme GmbH · live",
          status: "Ready",
          units: 31,
        }),
      ]),
    );
    expect(cell(container!, "order-1001", "status")!.textContent).toBe("Ready");
    expect(isFlashing(cell(container!, "order-1001", "status"))).toBe(true);
  });

  it("keeps flash when React echoes an equivalent accepted sequence without immutableRows", async () => {
    const { apiRef } = await mountHarness(false);

    await act(async () => {
      apiRef.current?.applyOne("slice");
    });
    await flushGridRenders();
    expectOrder1001FlashAndCustomerOptOut();
  });

  it("keeps flash after echoing an async flushed transaction result", async () => {
    const { apiRef } = await mountHarness();

    await act(async () => {
      apiRef.current?.applyAsyncOne();
    });
    await flushGridRenders();

    expect(cell(container!, "order-1002", "customer")!.textContent).toBe(
      "Globex Corporation · live",
    );
    expect(cell(container!, "order-1002", "status")!.textContent).toBe("Shipped");
    expect(cell(container!, "order-1002", "units")!.textContent).toBe("55");
    expect(isFlashing(cell(container!, "order-1002", "customer"))).toBe(false);
    expect(isFlashing(cell(container!, "order-1002", "status"))).toBe(true);
    expect(isFlashing(cell(container!, "order-1002", "units"))).toBe(true);
  });

  it("replaces rows and does not replay flash for a new object snapshot", async () => {
    const { apiRef } = await mountHarness();

    await act(async () => {
      apiRef.current?.applyOne();
    });
    await act(async () => {
      apiRef.current?.replaceAuthoritativeSnapshot();
    });
    await flushGridRenders();

    expect(cell(container!, "order-1001", "customer")!.textContent).toBe(
      "Replacement GmbH",
    );
    expect(cell(container!, "order-1001", "status")!.textContent).toBe("Shipped");
    expect(cell(container!, "order-1001", "units")!.textContent).toBe("99");
    expect(isFlashing(cell(container!, "order-1001", "customer"))).toBe(false);
    expect(isFlashing(cell(container!, "order-1001", "status"))).toBe(false);
    expect(isFlashing(cell(container!, "order-1001", "units"))).toBe(false);
    expect(
      cell(container!, "order-1001", "status")!.classList.contains(FLASH_B_CLASS),
    ).toBe(false);
  });
});
