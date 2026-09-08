// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { syncRowPinLaneDom } from "../../features/row-pinning/rowPinLaneDom";
import type { PinnedRowEntry } from "../../features/row-pinning/rowPinningRenderModel";
import { DomPoolManager } from "../../rendering/dom/DomPoolManager";
import { computeRowPoolSize } from "../../rendering/helpers/calculatePoolSize";
import type { GridSkeleton } from "../../types";
import type { GridLayoutMetrics } from "../gridLayoutMetrics";

const COMPACT: GridLayoutMetrics = {
  rowHeight: 32,
  headerHeight: 36,
};

describe("computeRowPoolSize with non-default metrics", () => {
  it("uses custom rowHeight and headerHeight", () => {
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", { value: 400 });

    const withDefaults = computeRowPoolSize(viewport, 1000, false);
    const withCompact = computeRowPoolSize(viewport, 1000, false, COMPACT);

    expect(withCompact).not.toBe(withDefaults);
    // bodyHeight = max(32, 400 - 36) = 364; visible = ceil(364/32) = 12; pool = 12 + 10 = 22
    expect(withCompact).toBe(22);
  });

  it("falls back to constants when metrics omitted", () => {
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", { value: 400 });

    const withUndefined = computeRowPoolSize(viewport, 1000, false, undefined);
    const withoutArg = computeRowPoolSize(viewport, 1000, false);
    expect(withUndefined).toBe(withoutArg);
  });
});

describe("DomPoolManager.updateScrollHeight with non-default metrics", () => {
  it("uses layoutMetrics for scroll height calculation", () => {
    const scrollContainer = document.createElement("div");
    const skeleton = {
      root: document.createElement("div"),
      surface: document.createElement("div"),
      header: document.createElement("div"),
      scrollContainer,
      viewport: document.createElement("div"),
    };

    const pm = new DomPoolManager({
      skeleton,
      getLayoutMetrics: () => COMPACT,
      suppressRowVirtualization: () => false,
      suppressColumnVirtualization: () => false,
    });

    pm.updateScrollHeight(10, 64, 32);
    // totalHeight = headerHeight(36) + topPinned(64) + 10*rowHeight(32) + bottomPinned(32) = 452
    expect(scrollContainer.style.height).toBe("452px");
  });
});

describe("rowPinLaneDom with non-default metrics", () => {
  function makeEntry(id: string): PinnedRowEntry {
    return {
      displayIndex: 0,
      rowId: id,
      row: { id },
    };
  }

  function makeSkeleton() {
    const root = document.createElement("div");
    const header = document.createElement("div");
    const scrollContainer = document.createElement("div");
    const viewport = document.createElement("div");
    scrollContainer.appendChild(header);
    root.appendChild(scrollContainer);
    return { root, header, scrollContainer, viewport } as unknown as GridSkeleton;
  }

  const emptyPinningLayout = {
    leftPinned: [],
    center: [{ field: "a", headerName: "A" }],
    rightPinned: [],
    ordered: [{ field: "a", headerName: "A" }],
  };

  const bindOptions = { dataRevision: 0 };

  it("sets row height from metrics, not default 40px", () => {
    const skeleton = makeSkeleton();
    const entries = [makeEntry("r1"), makeEntry("r2")];

    const state = syncRowPinLaneDom(
      skeleton, entries, emptyPinningLayout, 1,
      "top", undefined, bindOptions, COMPACT,
    );

    expect(state).toBeDefined();
    // Center flow layer height = 2 entries * 32px = 64px
    expect(state!.centerLayer.style.height).toBe("64px");
    // Individual pooled rows should have 32px height
    expect(state!.centerPoolRows[0]!.element.style.height).toBe("32px");
    expect(state!.centerPoolRows[1]!.element.style.height).toBe("32px");
  });

  it("positions overlay rows at rowHeight intervals", () => {
    const skeleton = makeSkeleton();
    const entries = [makeEntry("r1"), makeEntry("r2"), makeEntry("r3")];

    const layout = {
      leftPinned: [{ field: "lp", headerName: "LP" }],
      center: [{ field: "a", headerName: "A" }],
      rightPinned: [],
      ordered: [{ field: "lp" }, { field: "a" }],
    };

    const state = syncRowPinLaneDom(
      skeleton, entries, layout, 1,
      "top", undefined, bindOptions, COMPACT,
    );

    expect(state).toBeDefined();
    // Left overlay rows should be positioned at i * 32px
    expect(state!.leftPoolRows[0]!.element.style.top).toBe("0px");
    expect(state!.leftPoolRows[1]!.element.style.top).toBe("32px");
    expect(state!.leftPoolRows[2]!.element.style.top).toBe("64px");
  });

  it("updates flow layer height on reuse path with non-default metrics", () => {
    const skeleton = makeSkeleton();
    const entries1 = [makeEntry("r1"), makeEntry("r2")];

    const state1 = syncRowPinLaneDom(
      skeleton, entries1, emptyPinningLayout, 1,
      "top", undefined, bindOptions, COMPACT,
    );
    expect(state1!.centerLayer.style.height).toBe("64px");

    // Trigger reuse path with same structure but different entries ref
    const entries2 = [makeEntry("r1"), makeEntry("r2")];
    const state2 = syncRowPinLaneDom(
      skeleton, entries2, emptyPinningLayout, 1,
      "top", state1, { dataRevision: 1 }, COMPACT,
    );
    // Still 2 * 32 = 64px
    expect(state2!.centerLayer.style.height).toBe("64px");
  });
});
