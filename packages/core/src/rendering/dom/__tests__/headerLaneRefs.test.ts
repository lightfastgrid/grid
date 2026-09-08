// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import type { GridLayoutMetrics } from "../../../layout/gridLayoutMetrics";
import type { ColumnDef, GridSkeleton } from "../../../types";
import { CSS } from "../../const/css-classes";
import { DomPoolManager } from "../DomPoolManager";

const METRICS: GridLayoutMetrics = {
  rowHeight: 40,
  headerHeight: 40,
};

function makeSkeleton(): GridSkeleton {
  const root = document.createElement("div");
  const header = document.createElement("div");
  header.className = "lfg-header";
  const scrollContainer = document.createElement("div");
  scrollContainer.className = "lfg-scroll-container";
  const viewport = document.createElement("div");
  viewport.className = "lfg-viewport";
  scrollContainer.appendChild(header);
  root.appendChild(scrollContainer);
  Object.defineProperty(viewport, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(viewport, "clientHeight", { value: 400, configurable: true });
  return { root, surface: root, header, scrollContainer, viewport };
}

function makePoolManager(skeleton: GridSkeleton): DomPoolManager {
  return new DomPoolManager({
    skeleton,
    getLayoutMetrics: () => METRICS,
    suppressRowVirtualization: () => true,
    suppressColumnVirtualization: () => true,
  });
}

describe("DomPoolManager.getHeaderLaneRefs", () => {
  it("returns center lane ref with header container and leaf row", () => {
    const skeleton = makeSkeleton();
    const pm = makePoolManager(skeleton);
    const columns: ColumnDef[] = [{ field: "a", headerName: "A" }];

    pm.rebuild(columns, 0);

    const refs = pm.getHeaderLaneRefs();
    expect(refs).not.toBeNull();
    expect(refs!.center.container).toBe(skeleton.header);
    expect(refs!.center.leafRow).toBe(pm.headerRowEl);
    expect(refs!.left).toBeNull();
    expect(refs!.right).toBeNull();
  });

  it("creates pinned-left stack when left-pinned columns exist", () => {
    const skeleton = makeSkeleton();
    const pm = makePoolManager(skeleton);
    const columns: ColumnDef[] = [
      { field: "left", headerName: "Left", pinned: "left" },
      { field: "center", headerName: "Center" },
    ];

    pm.rebuild(columns, 0);

    const refs = pm.getHeaderLaneRefs();
    expect(refs!.left).not.toBeNull();
    expect(refs!.left!.container.classList.contains(CSS.PINNED_HEADER_STACK)).toBe(true);
    expect(refs!.left!.container.classList.contains(CSS.PINNED_LEFT_HEADER_STACK)).toBe(true);
    expect(refs!.left!.leafRow).toBe(pm.pinnedHeaderRowEl);
    expect(refs!.left!.container).toBe(pm.pinnedLeftHeaderStackEl);
    expect(refs!.left!.container.contains(refs!.left!.leafRow)).toBe(true);
  });

  it("creates pinned-right stack when right-pinned columns exist", () => {
    const skeleton = makeSkeleton();
    const pm = makePoolManager(skeleton);
    const columns: ColumnDef[] = [
      { field: "center", headerName: "Center" },
      { field: "right", headerName: "Right", pinned: "right" },
    ];

    pm.rebuild(columns, 0);

    const refs = pm.getHeaderLaneRefs();
    expect(refs!.right).not.toBeNull();
    expect(refs!.right!.container.classList.contains(CSS.PINNED_HEADER_STACK)).toBe(true);
    expect(refs!.right!.container.classList.contains(CSS.PINNED_RIGHT_HEADER_STACK)).toBe(true);
    expect(refs!.right!.leafRow).toBe(pm.pinnedRightHeaderRowEl);
    expect(refs!.right!.container).toBe(pm.pinnedRightHeaderStackEl);
    expect(refs!.right!.container.contains(refs!.right!.leafRow)).toBe(true);
  });

  it("keeps pinned leaf rows as the same elements returned by existing getters", () => {
    const skeleton = makeSkeleton();
    const pm = makePoolManager(skeleton);
    const columns: ColumnDef[] = [
      { field: "left", headerName: "Left", pinned: "left" },
      { field: "center", headerName: "Center" },
      { field: "right", headerName: "Right", pinned: "right" },
    ];

    pm.rebuild(columns, 0);

    const refs = pm.getHeaderLaneRefs();
    expect(refs!.left!.leafRow).toBe(pm.pinnedHeaderRowEl);
    expect(refs!.right!.leafRow).toBe(pm.pinnedRightHeaderRowEl);
    expect(skeleton.pinnedHeaderRow).toBe(pm.pinnedHeaderRowEl);
    expect(skeleton.pinnedRightHeaderRow).toBe(pm.pinnedRightHeaderRowEl);
  });

  it("does not create column group header rows", () => {
    const skeleton = makeSkeleton();
    const pm = makePoolManager(skeleton);
    const columns: ColumnDef[] = [
      { field: "left", headerName: "Left", pinned: "left" },
      { field: "center", headerName: "Center" },
      { field: "right", headerName: "Right", pinned: "right" },
    ];

    pm.rebuild(columns, 0);

    expect(skeleton.root.querySelector(".lfg-group-header-row")).toBeNull();
    expect(skeleton.scrollContainer.querySelectorAll(".lfg-group-header-row")).toHaveLength(0);
  });
});
