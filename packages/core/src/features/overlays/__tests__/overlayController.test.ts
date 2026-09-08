// @vitest-environment jsdom
//
// DOM tests for the overlay feature: OverlayController + OverlayLayer.
// Also covers Grid integration so we can verify the layer is created
// outside .lfg-viewport/.lfg-scroll-container/.lfg-row/.lfg-cell.

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Grid as GridT } from "../../../Grid";
import { Grid } from "../../../Grid";
import type {
  GridOverlayKind,
  GridOverlayRenderContext,
  GridOverlaysOptions,
  RowData,
} from "../../../types";
import { OverlayController } from "../OverlayController";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

// ── Controller-only tests (no Grid mount) ─────────────────────

describe("OverlayController — resolution priority", () => {
  function makeController(opts: {
    loading?: boolean;
    manualOverlay?: GridOverlayKind | null;
    rows?: RowData[];
    overlays?: GridOverlaysOptions;
  }) {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const controller = new OverlayController({
      gridRoot: root,
      getOverlayState: () => ({
        loading: opts.loading ?? false,
        manualOverlay: opts.manualOverlay ?? null,
        overlays: opts.overlays,
      }),
      getDisplayRowCount: () => (opts.rows ?? []).length,
      getGridInstance: () => null,
    });
    return { root, controller };
  }

  it("loading=true renders the loading overlay", () => {
    const { root, controller } = makeController({ loading: true });
    controller.sync();
    const layer = root.querySelector(".lfg-overlay-layer") as HTMLElement;
    expect(layer.getAttribute("data-visible")).toBe("true");
    const host = layer.querySelector(".lfg-overlay") as HTMLElement;
    expect(host.getAttribute("data-overlay-kind")).toBe("loading");
    expect(host.textContent).toBe("Loading...");
  });

  it("rows=[] renders the no-rows overlay", () => {
    const { root, controller } = makeController({ rows: [] });
    controller.sync();
    const host = root.querySelector(".lfg-overlay") as HTMLElement;
    expect(host.getAttribute("data-overlay-kind")).toBe("noRows");
    expect(host.textContent).toBe("No rows");
  });

  it("loading wins over no-rows", () => {
    const { root, controller } = makeController({ loading: true, rows: [] });
    controller.sync();
    const host = root.querySelector(".lfg-overlay") as HTMLElement;
    expect(host.getAttribute("data-overlay-kind")).toBe("loading");
  });

  it("manualOverlay wins over loading", () => {
    const { root, controller } = makeController({
      loading: true,
      manualOverlay: "noMatchingRows",
    });
    controller.sync();
    const host = root.querySelector(".lfg-overlay") as HTMLElement;
    expect(host.getAttribute("data-overlay-kind")).toBe("noMatchingRows");
    expect(host.textContent).toBe("No matching rows");
  });

  it("no overlay when loading=false and rows non-empty", () => {
    const { root, controller } = makeController({
      loading: false,
      rows: [{ id: "r1" }],
    });
    controller.sync();
    const layer = root.querySelector(".lfg-overlay-layer") as HTMLElement | null;
    // Layer may be lazily created; if it exists, it must be hidden.
    if (layer !== null) {
      expect(layer.getAttribute("data-visible")).toBeNull();
    }
  });

  it("layer hides after an overlay is dismissed", () => {
    let state = {
      loading: true,
      manualOverlay: null as null | GridOverlayKind,
      overlays: undefined as GridOverlaysOptions | undefined,
    };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const controller = new OverlayController({
      gridRoot: root,
      getOverlayState: () => state,
      getDisplayRowCount: () => 1,
      getGridInstance: () => null,
    });
    controller.sync();
    const layer = root.querySelector(".lfg-overlay-layer") as HTMLElement;
    expect(layer.getAttribute("data-visible")).toBe("true");

    state = { ...state, loading: false };
    controller.sync();
    expect(layer.getAttribute("data-visible")).toBeNull();
  });

  it("custom text renders via textContent (no HTML parsing)", () => {
    const { root, controller } = makeController({
      loading: true,
      overlays: { loading: { text: "<b>XSS</b>" } },
    });
    controller.sync();
    const host = root.querySelector(".lfg-overlay") as HTMLElement;
    expect(host.textContent).toBe("<b>XSS</b>");
    expect(host.querySelector("b")).toBeNull();
  });

  it("multi-token className applies and is removed cleanly on swap and clear", () => {
    let state = {
      loading: true,
      manualOverlay: null as null | GridOverlayKind,
      overlays: { loading: { className: "a b c" } } as GridOverlaysOptions,
    };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const controller = new OverlayController({
      gridRoot: root,
      getOverlayState: () => state,
      getDisplayRowCount: () => 0,
      getGridInstance: () => null,
    });

    controller.sync();
    const host = root.querySelector(".lfg-overlay") as HTMLElement;
    // All three custom tokens applied; base class preserved.
    expect(host.classList.contains("a")).toBe(true);
    expect(host.classList.contains("b")).toBe(true);
    expect(host.classList.contains("c")).toBe(true);
    expect(host.classList.contains("lfg-overlay")).toBe(true);

    // Swap to a different className with overlapping tokens — only stale
    // tokens removed; common tokens preserved without flicker.
    state = {
      ...state,
      overlays: { loading: { className: "a d" } },
    };
    controller.sync();
    expect(host.classList.contains("a")).toBe(true);
    expect(host.classList.contains("b")).toBe(false);
    expect(host.classList.contains("c")).toBe(false);
    expect(host.classList.contains("d")).toBe(true);
    expect(host.classList.contains("lfg-overlay")).toBe(true);

    // Clear overlay — all custom tokens removed, base class preserved.
    state = { loading: false, manualOverlay: null, overlays: state.overlays };
    controller.sync();
    expect(host.classList.contains("a")).toBe(false);
    expect(host.classList.contains("d")).toBe(false);
    expect(host.classList.contains("lfg-overlay")).toBe(true);
  });

  it("custom className applies and is removed when overlay kind changes", () => {
    let state = {
      loading: true,
      manualOverlay: null as null | GridOverlayKind,
      overlays: { loading: { className: "my-loading" } } as GridOverlaysOptions,
    };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const controller = new OverlayController({
      gridRoot: root,
      getOverlayState: () => state,
      getDisplayRowCount: () => 0,
      getGridInstance: () => null,
    });

    controller.sync();
    const host = root.querySelector(".lfg-overlay") as HTMLElement;
    expect(host.classList.contains("my-loading")).toBe(true);

    // Switch to noRows (no className configured) — old class must be removed.
    state = { loading: false, manualOverlay: null, overlays: state.overlays };
    controller.sync();
    expect(host.classList.contains("my-loading")).toBe(false);
  });

  it("custom render runs and cleanup runs on hide", () => {
    const cleanup = vi.fn();
    const render = vi.fn((_ctx: GridOverlayRenderContext) => {
      _ctx.host.textContent = "custom";
      return cleanup;
    });
    let state = {
      loading: true,
      manualOverlay: null as null | GridOverlayKind,
      overlays: { loading: { render } } as GridOverlaysOptions,
    };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const controller = new OverlayController({
      gridRoot: root,
      getOverlayState: () => state,
      getDisplayRowCount: () => 1,
      getGridInstance: () => null,
    });

    controller.sync();
    expect(render).toHaveBeenCalledTimes(1);
    const host = root.querySelector(".lfg-overlay") as HTMLElement;
    expect(host.textContent).toBe("custom");

    // Now hide (loading=false, rows non-empty → no overlay).
    state = { ...state, loading: false };
    controller.sync();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("custom render cleanup runs on destroy", () => {
    const cleanup = vi.fn();
    const root = document.createElement("div");
    document.body.appendChild(root);
    const controller = new OverlayController({
      gridRoot: root,
      getOverlayState: () => ({
        loading: true,
        manualOverlay: null,
        overlays: { loading: { render: () => cleanup } },
      }),
      getDisplayRowCount: () => 0,
      getGridInstance: () => null,
    });
    controller.sync();
    controller.destroy();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("custom render cleanup runs on kind change", () => {
    const cleanup = vi.fn();
    let kind: "loading" | "noRows" = "loading";
    const root = document.createElement("div");
    document.body.appendChild(root);
    const controller = new OverlayController({
      gridRoot: root,
      getOverlayState: () => ({
        loading: kind === "loading",
        manualOverlay: kind === "noRows" ? "noRows" : null,
        overlays: { loading: { render: () => cleanup } },
      }),
      getDisplayRowCount: () => 0,
      getGridInstance: () => null,
    });

    controller.sync();
    kind = "noRows";
    controller.sync();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("repeated sync with identical state is a no-op (single layer, no rerender)", () => {
    const render = vi.fn();
    const root = document.createElement("div");
    document.body.appendChild(root);
    const overlays: GridOverlaysOptions = { loading: { render } };
    const controller = new OverlayController({
      gridRoot: root,
      getOverlayState: () => ({
        loading: true,
        manualOverlay: null,
        overlays,
      }),
      getDisplayRowCount: () => 0,
      getGridInstance: () => null,
    });

    controller.sync();
    controller.sync();
    controller.sync();
    expect(render).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll(".lfg-overlay-layer").length).toBe(1);
    expect(root.querySelectorAll(".lfg-overlay").length).toBe(1);
  });

  it("custom render receives the live grid instance", () => {
    const grid: GridT = {} as GridT;
    const captured: { grid: GridT | null }[] = [];
    const root = document.createElement("div");
    document.body.appendChild(root);
    const controller = new OverlayController({
      gridRoot: root,
      getOverlayState: () => ({
        loading: true,
        manualOverlay: null,
        overlays: {
          loading: {
            render: (ctx) => {
              captured.push({ grid: ctx.grid });
            },
          },
        },
      }),
      getDisplayRowCount: () => 0,
      getGridInstance: () => grid,
    });
    controller.sync();
    expect(captured[0]?.grid).toBe(grid);
  });
});

// ── Grid integration ────────────────────────────────────────

describe("Grid integration — overlay feature wiring", () => {
  let grid: Grid | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    grid?.destroy();
    container?.remove();
    grid = null;
    container = null;
  });

  function mount(opts: {
    rows?: RowData[];
    loading?: boolean;
    overlays?: GridOverlaysOptions;
  }) {
    container = document.createElement("div");
    Object.assign(container.style, { height: "240px", width: "480px" });
    document.body.appendChild(container);

    grid = new Grid({
      rows: opts.rows ?? [],
      columns: [{ field: "a" }],
      getRowId: (row) => String((row as Record<string, unknown>).id),
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      loading: opts.loading,
      overlays: opts.overlays,
    });
    grid.mount(container);
    return container;
  }

  it("does not show a stale noRows overlay before/after first render when mounted with rows", async () => {
    const c = mount({ rows: [{ id: "r1" }], loading: false });
    // Immediately after mount, before first rAF: no overlay layer should exist.
    expect(c.querySelector(".lfg-overlay-layer")).toBeNull();

    await flushRenders();
    // After the first render, with rows present and not loading, no overlay
    // should be visible (and ideally no layer was ever created).
    const layer = c.querySelector(".lfg-overlay-layer") as HTMLElement | null;
    if (layer !== null) {
      expect(layer.getAttribute("data-visible")).toBeNull();
    }
  });

  it("overlay layer is OUTSIDE viewport/scroll-container/rows/cells", async () => {
    const c = mount({ rows: [{ id: "r1" }], loading: true });
    await flushRenders();

    const layer = c.querySelector(".lfg-overlay-layer") as HTMLElement;
    expect(layer).not.toBeNull();
    expect(layer.closest(".lfg-viewport")).toBeNull();
    expect(layer.closest(".lfg-scroll-container")).toBeNull();
    expect(layer.closest(".lfg-row")).toBeNull();
    expect(layer.closest(".lfg-cell")).toBeNull();
  });

  it("loading=true renders loading overlay end-to-end", async () => {
    const c = mount({ rows: [{ id: "r1" }], loading: true });
    await flushRenders();
    const host = c.querySelector(".lfg-overlay") as HTMLElement;
    expect(host.getAttribute("data-overlay-kind")).toBe("loading");
    expect(host.textContent).toBe("Loading...");
  });

  it("rows=[] renders no-rows overlay end-to-end", async () => {
    const c = mount({ rows: [] });
    await flushRenders();
    const host = c.querySelector(".lfg-overlay") as HTMLElement;
    expect(host.getAttribute("data-overlay-kind")).toBe("noRows");
    expect(host.textContent).toBe("No rows");
  });

  it("hideOverlay clears manual overlay; automatic loading/noRows can appear again", async () => {
    const c = mount({ rows: [{ id: "r1" }] });
    await flushRenders();
    grid!.showNoMatchingRowsOverlay();
    await flushRenders();
    expect(
      (c.querySelector(".lfg-overlay") as HTMLElement).getAttribute(
        "data-overlay-kind",
      ),
    ).toBe("noMatchingRows");

    grid!.hideOverlay();
    grid!.setLoading(true);
    await flushRenders();
    expect(
      (c.querySelector(".lfg-overlay") as HTMLElement).getAttribute(
        "data-overlay-kind",
      ),
    ).toBe("loading");
  });

  it("repeated renders do not duplicate layer or host", async () => {
    const c = mount({ rows: [], loading: false });
    await flushRenders();
    grid!.setLoading(true);
    await flushRenders();
    grid!.hideOverlay();
    await flushRenders();
    grid!.showNoRowsOverlay();
    await flushRenders();

    expect(c.querySelectorAll(".lfg-overlay-layer").length).toBe(1);
    expect(c.querySelectorAll(".lfg-overlay").length).toBe(1);
  });
});
