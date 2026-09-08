// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type {
  DomGridFeature,
  HeaderAddonCapability,
  HeaderAddonSyncContext,
  HeaderLaneRefs,
} from "../../../features/types";
import { normalizeColumnOrder } from "../../../utils/columnOrderConfig";
import { normalizeColumnSelection } from "../../../utils/columnSelectionConfig";
import { normalizeRowDrag } from "../../../utils/rowDragConfig";
import { normalizeRowSelection } from "../../../utils/rowSelectionConfig";
import { createArrayDisplayRowReader } from "../../rowViewAccess";
import type { DomFeatureHostDeps } from "../DomFeatureHost";
import { DomFeatureHost } from "../DomFeatureHost";

function makeDeps(overrides?: Partial<DomFeatureHostDeps>): DomFeatureHostDeps {
  return {
    getPool: () => [],
    getColumns: () => [],
    getDisplayRows: () => createArrayDisplayRowReader([]),
    getSourceRows: () => [],
    getVisibleRowStart: () => 0,
    getColumnOrderConfig: () => normalizeColumnOrder(undefined),
    getRowSelectionConfig: () => normalizeRowSelection(undefined),
    getRowDragConfig: () => normalizeRowDrag(undefined),
    getColumnSelectionConfig: () => normalizeColumnSelection(undefined),
    resolveRowId: (_row, i) => String(i),
    getHeaderRowEl: () => null,
    getPinnedHeaderRowEl: () => null,
    getPinnedRightHeaderRowEl: () => null,
    getHeaderLaneRefs: () => null,
    getColumnGroupHeaders: () => undefined,
    getDataRevision: () => 1,
    requestSync: () => {},
    requestColumnTransformSync: () => {},
    commitResize: () => {},
    syncColumnSelectionClasses: () => {},
    getSortModel: () => [],
    isSortPending: () => false,
    toggleColumnSort: () => {},
    setColumnSort: () => {},
    pinColumn: () => {},
    ...overrides,
  };
}

function fakeHeaderAddon(
  name: string,
  height: number,
  syncSpy?: ReturnType<typeof vi.fn>,
): DomGridFeature & HeaderAddonCapability {
  return {
    name,
    attach() {},
    detach() {},
    getHeaderAddonHeight: () => height,
    syncHeaderAddon: (ctx: HeaderAddonSyncContext) => {
      syncSpy?.(ctx);
    },
  };
}

describe("DomFeatureHost header addon aggregation", () => {
  it("returns 0 when no header addon contributors exist", () => {
    const host = new DomFeatureHost(
      makeDeps({
        featuresOverride: [
          {
            name: "noop",
            attach() {},
            detach() {},
          },
        ],
      }),
    );
    expect(host.getHeaderAddonHeight()).toBe(0);
  });

  it("sums multiple HeaderAddonCapability contributors", () => {
    const host = new DomFeatureHost(
      makeDeps({
        featuresOverride: [
          fakeHeaderAddon("a", 10),
          fakeHeaderAddon("b", 22),
          {
            name: "noop",
            attach() {},
            detach() {},
          },
        ],
      }),
    );
    expect(host.getHeaderAddonHeight()).toBe(32);
  });

  it("dispatches syncHeaderAddons to all contributors", () => {
    const spyA = vi.fn();
    const spyB = vi.fn();
    const host = new DomFeatureHost(
      makeDeps({
        featuresOverride: [
          fakeHeaderAddon("a", 10, spyA),
          fakeHeaderAddon("b", 5, spyB),
        ],
      }),
    );

    const laneRefs: HeaderLaneRefs = {
      center: {
        container: document.createElement("div"),
        leafRow: document.createElement("div"),
      },
      left: null,
      right: null,
    };
    const ctx: HeaderAddonSyncContext = {
      centerWindow: { startCol: 0, endCol: 1 },
      lanes: {
        left: null,
        center: { columns: [], prefixEdges: [0], containerOffsetX: 0 },
        right: null,
      },
      headerLaneRefs: laneRefs,
      layoutVersion: 3,
    };

    host.syncHeaderAddons(ctx);
    expect(spyA).toHaveBeenCalledTimes(1);
    expect(spyB).toHaveBeenCalledTimes(1);
    expect(spyA).toHaveBeenCalledWith(ctx);
    expect(spyB).toHaveBeenCalledWith(ctx);
  });
});
