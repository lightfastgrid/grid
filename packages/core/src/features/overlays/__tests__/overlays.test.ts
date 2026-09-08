// State/API tests for overlay foundation. No DOM, no Grid mount.
//
// Covers:
// - props.loading flows into initial state
// - setLoading / showLoadingOverlay / showNoRowsOverlay /
//   showNoMatchingRowsOverlay / hideOverlay state transitions
// - snapshot exposes loading, manualOverlay, overlays
// - no-op writes don't bump state (state-level revision counter check)

import { describe, expect, it } from "vitest";

import { GridState } from "../../../state/GridState";
import type { GridOverlaysOptions } from "../../../types";

describe("GridState — overlay state", () => {
  it("initial loading comes from props.loading (default false)", () => {
    const a = new GridState({ rows: [], columns: [{ field: "a" }] });
    expect(a.getOverlayState().loading).toBe(false);

    const b = new GridState({
      rows: [],
      columns: [{ field: "a" }],
      loading: true,
    });
    expect(b.getOverlayState().loading).toBe(true);
  });

  it("setLoading(true/false) changes snapshot loading", () => {
    const state = new GridState({ rows: [], columns: [{ field: "a" }] });

    expect(state.getSnapshot().loading).toBe(false);
    expect(state.setLoading(true)).toBe(true);
    expect(state.getSnapshot().loading).toBe(true);

    expect(state.setLoading(false)).toBe(true);
    expect(state.getSnapshot().loading).toBe(false);
  });

  it("repeated setLoading(same value) returns false (no change)", () => {
    const state = new GridState({
      rows: [],
      columns: [{ field: "a" }],
      loading: true,
    });
    expect(state.setLoading(true)).toBe(false);
    expect(state.setLoading(true)).toBe(false);
  });

  it("setManualOverlay sets and clears the manual overlay kind", () => {
    const state = new GridState({ rows: [], columns: [{ field: "a" }] });
    expect(state.getOverlayState().manualOverlay).toBeNull();

    expect(state.setManualOverlay("loading")).toBe(true);
    expect(state.getOverlayState().manualOverlay).toBe("loading");

    expect(state.setManualOverlay("noRows")).toBe(true);
    expect(state.getOverlayState().manualOverlay).toBe("noRows");

    expect(state.setManualOverlay("noMatchingRows")).toBe(true);
    expect(state.getOverlayState().manualOverlay).toBe("noMatchingRows");

    expect(state.setManualOverlay(null)).toBe(true);
    expect(state.getOverlayState().manualOverlay).toBeNull();
  });

  it("repeated setManualOverlay(same value) returns false", () => {
    const state = new GridState({ rows: [], columns: [{ field: "a" }] });
    state.setManualOverlay("loading");
    expect(state.setManualOverlay("loading")).toBe(false);
    expect(state.setManualOverlay("loading")).toBe(false);
  });

  it("overlays prop is preserved in snapshot", () => {
    const overlays: GridOverlaysOptions = {
      loading: { text: "Loading…" },
      noRows: { text: "No rows" },
      noMatchingRows: { text: "No matching rows" },
    };
    const state = new GridState({
      rows: [],
      columns: [{ field: "a" }],
      overlays,
    });
    expect(state.getSnapshot().overlays).toBe(overlays);
  });

  it("setOverlays swaps overlay reference and reports change", () => {
    const initial: GridOverlaysOptions = { loading: { text: "Hi" } };
    const state = new GridState({
      rows: [],
      columns: [{ field: "a" }],
      overlays: initial,
    });
    expect(state.getOverlayState().overlays).toBe(initial);

    const next: GridOverlaysOptions = { loading: { text: "Loading…" } };
    expect(state.setOverlays(next)).toBe(true);
    expect(state.getOverlayState().overlays).toBe(next);

    // Same reference → no change
    expect(state.setOverlays(next)).toBe(false);

    // Clear
    expect(state.setOverlays(undefined)).toBe(true);
    expect(state.getOverlayState().overlays).toBeUndefined();
  });

  it("snapshot exposes loading, manualOverlay, overlays together", () => {
    const overlays: GridOverlaysOptions = { loading: { text: "Loading…" } };
    const state = new GridState({
      rows: [{ id: "r1" }],
      columns: [{ field: "a" }],
      loading: true,
      overlays,
    });
    state.setManualOverlay("noRows");

    const snap = state.getSnapshot();
    expect(snap.loading).toBe(true);
    expect(snap.manualOverlay).toBe("noRows");
    expect(snap.overlays).toBe(overlays);
  });
});

// ── Grid runtime API integration ─────────────────────────────

import { Grid } from "../../../Grid";

describe("Grid — overlay runtime API", () => {
  function makeGrid(loading = false) {
    return new Grid({
      rows: [],
      columns: [{ field: "a" }],
      loading,
    });
  }

  it("setLoading toggles snapshot loading flag", () => {
    const grid = makeGrid(false);
    expect(grid.getOverlayState().loading).toBe(false);
    grid.setLoading(true);
    expect(grid.getOverlayState().loading).toBe(true);
    grid.setLoading(false);
    expect(grid.getOverlayState().loading).toBe(false);
    grid.destroy();
  });

  it("showLoadingOverlay sets manualOverlay to 'loading'", () => {
    const grid = makeGrid();
    grid.showLoadingOverlay();
    expect(grid.getOverlayState().manualOverlay).toBe("loading");
    grid.destroy();
  });

  it("showNoRowsOverlay sets manualOverlay to 'noRows'", () => {
    const grid = makeGrid();
    grid.showNoRowsOverlay();
    expect(grid.getOverlayState().manualOverlay).toBe("noRows");
    grid.destroy();
  });

  it("showNoMatchingRowsOverlay sets manualOverlay to 'noMatchingRows'", () => {
    const grid = makeGrid();
    grid.showNoMatchingRowsOverlay();
    expect(grid.getOverlayState().manualOverlay).toBe("noMatchingRows");
    grid.destroy();
  });

  it("hideOverlay clears manualOverlay", () => {
    const grid = makeGrid();
    grid.showNoRowsOverlay();
    expect(grid.getOverlayState().manualOverlay).toBe("noRows");
    grid.hideOverlay();
    expect(grid.getOverlayState().manualOverlay).toBeNull();
    grid.destroy();
  });

  it("hideOverlay does not change loading flag", () => {
    const grid = makeGrid(true);
    grid.showNoRowsOverlay();
    grid.hideOverlay();
    expect(grid.getOverlayState().loading).toBe(true);
    grid.destroy();
  });

  it("setOverlays updates snapshot.overlays reference", () => {
    const grid = makeGrid();
    const next: GridOverlaysOptions = { noRows: { text: "Empty" } };
    grid.setOverlays(next);
    expect(grid.getOverlayState().overlays).toBe(next);
    grid.destroy();
  });
});
