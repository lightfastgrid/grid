// @vitest-environment jsdom

import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";

import { Grid } from "../../../Grid";
import type {
  LightFastGridColumnInput,
  RowData,
} from "../../../types";
import { ACCESSIBILITY_OVERLAY_DESCRIPTION_CLASS } from "../accessibilityPersistentDescription";

const COLUMNS: LightFastGridColumnInput[] = [
  {
    headerName: "Identity",
    children: [
      {
        field: "name",
        headerName: "Name",
        pinned: "left",
        width: 150,
        filterable: true,
        sortable: true,
      },
      {
        field: "region",
        headerName: "Region",
        width: 130,
        filterable: true,
      },
    ],
  },
  {
    headerName: "Metrics",
    children: [
      {
        field: "amount",
        headerName: "Amount",
        width: 140,
        filterable: true,
        sortable: true,
      },
      {
        field: "status",
        headerName: "Status",
        width: 140,
        filterable: true,
      },
      {
        field: "score",
        headerName: "Score",
        pinned: "right",
        width: 120,
        sortable: true,
      },
    ],
  },
];

const ROWS: RowData[] = Array.from({ length: 40 }, (_, index) => ({
  id: `r${index}`,
  name: `Person ${index}`,
  region: index % 2 === 0 ? "North" : "South",
  amount: index * 100,
  status: index % 3 === 0 ? "Active" : "Pending",
  score: 100 - index,
}));

async function flushRenders(): Promise<void> {
  // End-of-scroll arming is scrollend-driven; dispatch then drain quiet frames.
  for (const viewport of document.querySelectorAll(".lfg-viewport")) {
    viewport.dispatchEvent(new Event("scrollend"));
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

interface MountedAcceptanceGrid {
  readonly grid: Grid;
  readonly container: HTMLDivElement;
  readonly root: HTMLElement;
  readonly surface: HTMLElement;
}

async function mountAcceptanceGrid(): Promise<MountedAcceptanceGrid> {
  const container = document.createElement("div");
  Object.assign(container.style, { width: "900px", height: "380px" });
  document.body.appendChild(container);
  const grid = new Grid({
    rows: ROWS,
    columns: COLUMNS,
    getRowId: (row) => String(row.id),
    accessibility: {
      ariaLabel: "Workforce planning",
      ariaDescribedBy: "application-grid-help",
    },
    rowSelection: {
      mode: "multiple",
      checkboxes: true,
      headerCheckbox: true,
    },
    columnSelection: { mode: "multiple" },
    initialSortModel: [
      { field: "amount", sort: "desc" },
      { field: "name", sort: "asc" },
    ],
    floatingFilters: true,
    columnMenu: {
      filter: { placement: "dedicatedMenu" },
    },
    pagination: true,
    paginationPageSize: 12,
    paginationPageSizeOptions: [12, 24],
    overlays: {
      loading: { text: "Loading workforce" },
    },
  });
  grid.mount(container);
  await flushRenders();
  await flushRenders();

  grid.setSelectedRowIds(["r1", "r2"]);
  grid.setSelectedColumnIds(["amount"]);
  await flushRenders();

  const focusCell = container.querySelector<HTMLElement>(
    '.lfg-cell[data-col-id="amount"]',
  );
  expect(focusCell).not.toBeNull();
  focusCell!.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    }),
  );

  const filterTrigger = container.querySelector<HTMLElement>(
    '.lfg-floating-filter-cell[data-col-id="amount"] .lfg-column-filter-trigger',
  );
  expect(filterTrigger).not.toBeNull();
  filterTrigger!.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    }),
  );

  grid.showLoadingOverlay();
  await flushRenders();

  return {
    grid,
    container,
    root: container.querySelector<HTMLElement>(".lfg-grid")!,
    surface: container.querySelector<HTMLElement>(".lfg-grid-surface")!,
  };
}

function ownedElements(row: HTMLElement): HTMLElement[] {
  const ids = row.getAttribute("aria-owns")?.split(/\s+/) ?? [];
  return ids.map((id) => {
    const element = document.getElementById(id);
    expect(element, `Missing aria-owns target ${id}`).not.toBeNull();
    return element!;
  });
}

describe("Accessibility V2 F16E semantic-tree acceptance", () => {
  let mounted: MountedAcceptanceGrid | null = null;

  afterEach(() => {
    mounted?.grid.destroy();
    mounted?.container.remove();
    mounted = null;
  });

  it("132 exposes one coherent high-complexity semantic tree", async () => {
    mounted = await mountAcceptanceGrid();
    const { container, root, surface } = mounted;

    expect(surface.getAttribute("role")).toBe("grid");
    expect(surface.getAttribute("aria-label")).toBe("Workforce planning");
    expect(surface.getAttribute("aria-multiselectable")).toBe("true");
    expect(surface.getAttribute("aria-busy")).toBe("true");
    expect(root.getAttribute("role")).toBeNull();

    const rows = Array.from(
      surface.querySelectorAll<HTMLElement>('[role="row"]'),
    );
    const rowIndexes = rows.map((row) =>
      Number(row.getAttribute("aria-rowindex")),
    );
    expect(rowIndexes.length).toBeGreaterThan(3);
    expect(rowIndexes).toEqual([...rowIndexes].sort((a, b) => a - b));
    expect(new Set(rowIndexes).size).toBe(rowIndexes.length);

    const ids = new Set<string>();
    const semanticCells = Array.from(
      surface.querySelectorAll<HTMLElement>(
        '[role="columnheader"], [role="gridcell"]',
      ),
    );
    for (const cell of semanticCells) {
      expect(cell.id).not.toBe("");
      expect(ids.has(cell.id)).toBe(false);
      ids.add(cell.id);
      expect(Number(cell.getAttribute("aria-colindex"))).toBeGreaterThan(0);
    }

    for (const row of rows) {
      const owned = ownedElements(row);
      if (owned.length === 0) continue;
      const indexes = owned.map((cell) =>
        Number(cell.getAttribute("aria-colindex")),
      );
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
      expect(new Set(indexes).size).toBe(indexes.length);
    }

    const primary = container.querySelector<HTMLElement>(
      '.lfg-header-cell[data-col-id="amount"]',
    )!;
    const secondary = container.querySelector<HTMLElement>(
      '.lfg-header-cell[data-col-id="name"]',
    )!;
    expect(primary.getAttribute("aria-sort")).toBe("descending");
    expect(secondary.getAttribute("aria-sort")).toBeNull();
    expect(primary.getAttribute("aria-describedby")).not.toBeNull();
    expect(secondary.getAttribute("aria-describedby")).not.toBeNull();
    expect(primary.getAttribute("aria-selected")).toBe("true");

    const activeId = surface.getAttribute("aria-activedescendant");
    expect(activeId).not.toBeNull();
    expect(document.getElementById(activeId!)).not.toBeNull();

    const popup = root.querySelector<HTMLElement>(
      '[id^="lfg-popup-dedicated-filter-"]',
    );
    expect(popup?.getAttribute("role")).toBe("dialog");
    expect(popup?.getAttribute("aria-modal")).toBe("false");
    const trigger = root.querySelector<HTMLElement>(
      `[aria-controls="${popup!.id}"]`,
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    const overlayDescription = root.querySelector<HTMLElement>(
      `.${ACCESSIBILITY_OVERLAY_DESCRIPTION_CLASS}`,
    );
    expect(overlayDescription?.textContent).toBe("Loading workforce");
    expect(surface.getAttribute("aria-describedby")?.split(/\s+/)).toEqual([
      "application-grid-help",
      overlayDescription!.id,
    ]);

    const pagination = root.querySelector(".lfg-pagination");
    expect(pagination).not.toBeNull();
    expect(surface.contains(pagination)).toBe(false);
  });

  it("133 passes supported axe rules and audits cross-lane ownership", async () => {
    mounted = await mountAcceptanceGrid();
    mounted.grid.hideOverlay();
    await flushRenders();

    const results = await axe.run(mounted.container, {
      runOnly: {
        type: "rule",
        values: [
          "aria-allowed-attr",
          "aria-allowed-role",
          "aria-command-name",
          "aria-conditional-attr",
          "aria-dialog-name",
          "aria-hidden-focus",
          "aria-input-field-name",
          "aria-prohibited-attr",
          "aria-required-attr",
          "aria-required-parent",
          "aria-roles",
          "aria-toggle-field-name",
          "aria-valid-attr-value",
          "aria-valid-attr",
          "button-name",
          "duplicate-id-aria",
          "label",
          "select-name",
        ],
      },
    });
    expect(results.violations).toEqual([]);

    const ownershipCounts = new Map<string, number>();
    const rows = mounted.surface.querySelectorAll<HTMLElement>('[role="row"]');
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]!;
      const ids = row.getAttribute("aria-owns")?.split(/\s+/) ?? [];
      for (const id of ids) {
        ownershipCounts.set(id, (ownershipCounts.get(id) ?? 0) + 1);
      }
    }

    const requiredChildren = await axe.run(mounted.container, {
      runOnly: {
        type: "rule",
        values: ["aria-required-children"],
      },
    });
    expect(requiredChildren.violations).toHaveLength(1);
    const [violation] = requiredChildren.violations;
    expect(violation?.id).toBe("aria-required-children");
    expect(violation?.nodes).toHaveLength(1);
    const [surfaceNode] = violation!.nodes;
    expect(surfaceNode?.target).toEqual([".lfg-grid-surface"]);

    const relatedNodes = surfaceNode!.any.flatMap(
      (check) => check.relatedNodes ?? [],
    );
    expect(relatedNodes.length).toBeGreaterThan(0);
    for (const related of relatedNodes) {
      const [selector] = related.target;
      if (typeof selector !== "string") {
        throw new Error("Expected axe to identify a physical semantic element");
      }
      expect(selector).toMatch(/^#/);
      const id = selector.slice(1);
      const element = document.getElementById(id);
      expect(element).not.toBeNull();
      expect(element?.matches('[role="columnheader"], [role="gridcell"]')).toBe(
        true,
      );
      expect(ownershipCounts.get(id)).toBe(1);
    }
  });
});
