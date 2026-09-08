import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "../../..");
const PLUGIN = join(SRC, "features", "accessibility");

function productionFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...productionFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

describe("Accessibility V2 isolated foundation guards", () => {
  it("keeps the neutral grid surface geometry-compatible with the former viewport flex slot", () => {
    const themeSource = readFileSync(
      join(SRC, "themes", "default.css"),
      "utf8",
    );
    const readRule = (selector: string): string => {
      const start = themeSource.indexOf(`${selector} {`);
      const end = themeSource.indexOf("}", start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      return themeSource.slice(start, end);
    };

    const surfaceRule = readRule(".lfg-grid-surface");
    expect(surfaceRule).toMatch(/\bflex:\s*1 1 auto\s*;/);
    expect(surfaceRule).toMatch(/\bmin-height:\s*0\s*;/);
    expect(surfaceRule).toMatch(/\bmin-width:\s*0\s*;/);
    expect(surfaceRule).toMatch(/\bdisplay:\s*flex\s*;/);

    const viewportRule = readRule(".lfg-viewport");
    expect(viewportRule).toMatch(/\bflex:\s*1 1 auto\s*;/);
    expect(viewportRule).toMatch(/\bmin-height:\s*0\s*;/);
  });

  it("134 keeps renderer scroll, virtual sync, pooling, and population accessibility-unaware", () => {
    const paths = [
      "rendering/DomGridRenderer.ts",
      "rendering/ring-buffer/VirtualWindowSync.ts",
      "rendering/dom/DomPoolManager.ts",
      "rendering/helpers/populateRow.ts",
    ];
    const forbidden =
      /features\/accessibility|notifySurfaceChanged|requestSurfaceReconcile|surface:changed|liveRegion|announcement|role=["']status/;
    const offenders: string[] = [];
    for (const path of paths) {
      const source = readFileSync(join(SRC, path), "utf8");
      if (forbidden.test(source)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the Section 12 status owner plugin-private and visually exposed to AT", () => {
    const liveRegionConsumers = productionFiles(SRC)
      .filter((file) =>
        /accessibilityLiveRegion|subscribeAccessibilityAnnouncements/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(SRC, file).split(sep).join("/"));
    expect(liveRegionConsumers).toEqual([
      "features/accessibility/accessibilityFeature.ts",
      "features/accessibility/subscribeAccessibilityAnnouncements.ts",
    ]);

    const themeSource = readFileSync(
      join(SRC, "themes", "default.css"),
      "utf8",
    );
    const ruleStart = themeSource.indexOf(".lfg-a11y-status {");
    const ruleEnd = themeSource.indexOf("}", ruleStart);
    const rule = themeSource.slice(ruleStart, ruleEnd);
    expect(ruleStart).toBeGreaterThanOrEqual(0);
    expect(rule).not.toMatch(
      /display\s*:\s*none|visibility\s*:\s*hidden/,
    );

    const accessibilityBarrel = readFileSync(
      join(PLUGIN, "index.ts"),
      "utf8",
    );
    expect(accessibilityBarrel).not.toMatch(
      /AccessibilityLiveRegion|subscribeAccessibilityAnnouncements/,
    );
    expect(readFileSync(join(SRC, "index.ts"), "utf8")).not.toMatch(
      /AccessibilityLiveRegion|subscribeAccessibilityAnnouncements/,
    );
  });

  it("keeps Section 13 overlay presentation neutral and off hot paths", () => {
    const pluginOffenders = productionFiles(PLUGIN)
      .filter((file) =>
        /features\/overlays|lfg-overlay|data-overlay-kind|querySelector\([^)]*overlay/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(PLUGIN, file).split(sep).join("/"));
    expect(pluginOffenders).toEqual([]);

    const overlayOffenders = productionFiles(
      join(SRC, "features", "overlays"),
    )
      .filter((file) =>
        /features\/accessibility|accessibilityLiveRegion|announceAccessibility/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(SRC, file).split(sep).join("/"));
    expect(overlayOffenders).toEqual([]);

    const eventConsumers = productionFiles(SRC)
      .filter((file) =>
        readFileSync(file, "utf8").includes(
          "overlay:presentation-changed",
        ),
      )
      .map((file) => relative(SRC, file).split(sep).join("/"));
    expect(eventConsumers).toEqual([
      "Grid.ts",
      "events/GridEventMap.ts",
      "features/accessibility/accessibilityFeature.ts",
      "features/accessibility/subscribeAccessibilityAnnouncements.ts",
    ]);
    expect(readFileSync(join(SRC, "index.ts"), "utf8")).not.toContain(
      "LightFastGridOverlayPresentationChangedEvent",
    );

    const rendererSource = readFileSync(
      join(SRC, "rendering", "DomGridRenderer.ts"),
      "utf8",
    );
    const scrollStart = rendererSource.indexOf(
      "  private readonly onViewportScroll",
    );
    const scrollEnd = rendererSource.indexOf("  constructor(", scrollStart);
    const scrollBody = rendererSource.slice(scrollStart, scrollEnd);
    expect(scrollStart).toBeGreaterThanOrEqual(0);
    expect(scrollEnd).toBeGreaterThan(scrollStart);
    expect(scrollBody).not.toMatch(
      /OverlayPresentation|overlay:presentation|announcement|liveRegion/,
    );

    const hotPaths = [
      "rendering/ring-buffer/VirtualWindowSync.ts",
      "rendering/dom/DomPoolManager.ts",
      "rendering/helpers/populateRow.ts",
    ];
    for (const path of hotPaths) {
      expect(readFileSync(join(SRC, path), "utf8")).not.toMatch(
        /OverlayPresentation|overlay:presentation|announcement|liveRegion/,
      );
    }
  });

  it("keeps root focusability outside plugin ownership", () => {
    const offenders: string[] = [];
    for (const file of productionFiles(PLUGIN)) {
      const source = readFileSync(file, "utf8");
      if (
        /\b(?:root|surface)\.tabIndex\s*=|\b(?:root|surface)\.setAttribute\(\s*["']tabindex["']/.test(
          source,
        )
      ) {
        offenders.push(relative(PLUGIN, file).split(sep).join("/"));
      }
    }
    expect(offenders).toEqual([]);

    const descendantTabStopOwners = productionFiles(PLUGIN)
      .filter((file) => /tabindex|tabIndex/.test(readFileSync(file, "utf8")))
      .map((file) => relative(PLUGIN, file).split(sep).join("/"));
    expect(descendantTabStopOwners).toEqual([
      "keyboard/KeyboardNavigationController.ts",
      "utils/bodyCellSemanticsDom.ts",
    ]);
  });

  it("keeps grouped-header integration neutral", () => {
    const pluginOffenders: string[] = [];
    for (const file of productionFiles(PLUGIN)) {
      const source = readFileSync(file, "utf8");
      if (
        /features\/column-groups|from\s+["'][^"']*column-groups/.test(source)
      ) {
        pluginOffenders.push(relative(PLUGIN, file).split(sep).join("/"));
      }
    }
    expect(pluginOffenders).toEqual([]);

    const groupFiles = productionFiles(
      join(SRC, "features", "column-groups"),
    );
    const groupOffenders = groupFiles
      .filter((file) =>
        /features\/accessibility|aria-colspan|role["'],\s*["']columnheader/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(SRC, file).split(sep).join("/"));
    expect(groupOffenders).toEqual([]);
  });

  it("keeps in-cell widget semantics owner-local and off plugin/runtime seams", () => {
    const pluginOffenders = productionFiles(PLUGIN)
      .filter((file) =>
        /lfg-cell-shell|lfg-action-trigger|lfg-row-selection-checkbox|features\/cell-shells|features\/row-actions/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(PLUGIN, file).split(sep).join("/"));
    expect(pluginOffenders).toEqual([]);

    const ownerPaths = [
      "features/cell-shells/CellShellManager.ts",
      "rendering/helpers/populateRow.ts",
    ];
    for (const path of ownerPaths) {
      const source = readFileSync(join(SRC, path), "utf8");
      expect(source).not.toMatch(
        /features\/accessibility|notifyAccessibility|requestAccessibility/,
      );
      expect(source).not.toContain("addEventListener(");
    }

    const runtimePaths = [
      "rendering/DomGridRenderer.ts",
      "rendering/ring-buffer/VirtualWindowSync.ts",
      "rendering/dom/DomPoolManager.ts",
    ];
    for (const path of runtimePaths) {
      const source = readFileSync(join(SRC, path), "utf8");
      expect(source).not.toMatch(
        /syncCellShellAccessibility|notifyCellWidgetSemantics|requestWidgetReconcile/,
      );
    }
  });

  it("keeps editor validation semantics owner-local and off plugin/runtime seams", () => {
    const pluginOffenders = productionFiles(PLUGIN)
      .filter((file) =>
        /lfg-cell-editor|lfg-editor-error|aria-errormessage|features\/editing/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(PLUGIN, file).split(sep).join("/"));
    expect(pluginOffenders).toEqual([]);

    const ownerFiles = productionFiles(join(SRC, "features", "editing"));
    const invalidWriters = ownerFiles
      .filter((file) =>
        /(?:setAttribute|removeAttribute)\(["']aria-invalid["']/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(SRC, file).split(sep).join("/"));
    const errorMessageWriters = ownerFiles
      .filter((file) =>
        /(?:setAttribute|removeAttribute)\(["']aria-errormessage["']/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(SRC, file).split(sep).join("/"));
    const requiredWriters = ownerFiles
      .filter((file) =>
        /(?:setAttribute|removeAttribute)\(["']aria-required["']/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(SRC, file).split(sep).join("/"));
    expect(invalidWriters).toEqual([
      "features/editing/editorValidationSemantics.ts",
    ]);
    expect(errorMessageWriters).toEqual([
      "features/editing/editorValidationSemantics.ts",
    ]);
    expect(requiredWriters).toEqual(["features/editing/EditorPool.ts"]);

    const themeSource = readFileSync(
      join(SRC, "themes", "default.css"),
      "utf8",
    );
    const errorRuleStart = themeSource.indexOf(".lfg-editor-error {");
    const errorRuleEnd = themeSource.indexOf("}", errorRuleStart);
    const errorRule = themeSource.slice(errorRuleStart, errorRuleEnd);
    expect(errorRuleStart).toBeGreaterThanOrEqual(0);
    expect(errorRule).not.toMatch(
      /display\s*:\s*none|visibility\s*:\s*hidden/,
    );

    const runtimePaths = [
      "rendering/DomGridRenderer.ts",
      "rendering/ring-buffer/VirtualWindowSync.ts",
      "rendering/dom/DomPoolManager.ts",
      "rendering/helpers/populateRow.ts",
    ];
    for (const path of runtimePaths) {
      expect(readFileSync(join(SRC, path), "utf8")).not.toMatch(
        /notifyEditorValidation|syncEditorAccessibility|requestEditorSemantics/,
      );
    }
  });

  it("keeps filter-control names owner-local and off plugin/runtime seams", () => {
    const pluginOffenders = productionFiles(PLUGIN)
      .filter((file) =>
        /lfg-filter-form|lfg-floating-filter|filterControlAccessibleName|features\/filters|features\/floating-filters/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(PLUGIN, file).split(sep).join("/"));
    expect(pluginOffenders).toEqual([]);

    const controlOwners = productionFiles(join(SRC, "features"))
      .filter((file) =>
        /createElement\(["'](?:input|select)["']\)/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .filter((file) =>
        /lfg-filter-form|lfg-floating-filter-input/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(SRC, file).split(sep).join("/"));
    expect(controlOwners).toEqual([
      "features/filters/filterMenuForm.ts",
      "features/floating-filters/FloatingFilterController.ts",
    ]);

    const runtimePaths = [
      "rendering/DomGridRenderer.ts",
      "rendering/ring-buffer/VirtualWindowSync.ts",
      "rendering/dom/DomPoolManager.ts",
      "rendering/helpers/populateRow.ts",
    ];
    for (const path of runtimePaths) {
      expect(readFileSync(join(SRC, path), "utf8")).not.toMatch(
        /filterControlAccessibleName|syncFilterControlAccessibility|requestFilterSemantics/,
      );
    }

    const privateHelper = "filterControlAccessibleName";
    const helperConsumers = productionFiles(SRC)
      .filter((file) => readFileSync(file, "utf8").includes(privateHelper))
      .map((file) => relative(SRC, file).split(sep).join("/"));
    expect(helperConsumers).toEqual([
      "features/filters/DedicatedFilterController.ts",
      "features/filters/filterMenuForm.ts",
      "features/floating-filters/FloatingFilterController.ts",
    ]);
    expect(
      readFileSync(join(SRC, "features", "filters", "index.ts"), "utf8"),
    ).not.toContain(privateHelper);
    expect(readFileSync(join(SRC, "index.ts"), "utf8")).not.toContain(
      privateHelper,
    );
  });

  it("keeps popup semantics in approved owners and off renderer scheduling", () => {
    const pluginOffenders = productionFiles(PLUGIN)
      .filter((file) =>
        /lfg-cell-menu|lfg-action-trigger|features\/cell-menu|features\/row-actions/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(PLUGIN, file).split(sep).join("/"));
    expect(pluginOffenders).toEqual([]);

    const helperConsumers = productionFiles(SRC)
      .filter((file) =>
        readFileSync(file, "utf8").includes("popupSemantics"),
      )
      .map((file) => relative(SRC, file).split(sep).join("/"));
    expect(helperConsumers).toEqual([
      "features/cell-menu/CellMenuController.ts",
      "features/cell-menu/resolveCellMenuPopupRole.ts",
      "features/column-menu/ColumnMenuController.ts",
      "features/filters/DedicatedFilterController.ts",
      "features/floating-filters/FloatingFilterController.ts",
      "features/menu/createMenuPanel.ts",
      "features/menu/types.ts",
      "features/row-actions/RowActionController.ts",
      "features/row-actions/rowActionDom.ts",
    ]);

    const falseModalClaims = productionFiles(SRC)
      .filter((file) =>
        /["']aria-modal["']\s*,\s*["']true["']/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(SRC, file).split(sep).join("/"));
    expect(falseModalClaims).toEqual([]);

    const runtimePaths = [
      "rendering/DomGridRenderer.ts",
      "rendering/ring-buffer/VirtualWindowSync.ts",
      "rendering/dom/DomPoolManager.ts",
    ];
    for (const path of runtimePaths) {
      expect(readFileSync(join(SRC, path), "utf8")).not.toMatch(
        /popupSemantics|connectPopupTrigger|disconnectPopupTrigger|requestPopupSemantics/,
      );
    }

    const menuBarrel = readFileSync(
      join(SRC, "features", "menu", "index.ts"),
      "utf8",
    );
    expect(menuBarrel).not.toMatch(/popupSemantics|PopupRole|PopupOwnerKind/);
    expect(readFileSync(join(SRC, "index.ts"), "utf8")).not.toMatch(
      /popupSemantics|PopupRole|PopupOwnerKind/,
    );
  });

  it("keeps aria-owns in one plugin-private DOM writer", () => {
    const pluginWriters = productionFiles(PLUGIN)
      .filter((file) =>
        /(?:setAttribute|removeAttribute)\(["']aria-owns["']/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(PLUGIN, file).split(sep).join("/"));
    expect(pluginWriters).toEqual(["utils/pinnedLaneOwnershipDom.ts"]);

    const outsideWriters = productionFiles(SRC)
      .filter((file) => !file.startsWith(PLUGIN + sep))
      .filter((file) =>
        /(?:setAttribute|removeAttribute)\(["']aria-owns["']/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(SRC, file).split(sep).join("/"));
    expect(outsideWriters).toEqual([]);
  });

  it("keeps logical-lane projection neutral, allocation-free, and off renderer scroll", () => {
    const laneSource = readFileSync(
      join(SRC, "features", "row-pinning", "rowPinLaneDom.ts"),
      "utf8",
    );
    const laneStart = laneSource.indexOf(
      "export function forEachLogicalRowPinLanePoolRow(",
    );
    const laneBody = laneSource.slice(laneStart);
    expect(laneStart).toBeGreaterThanOrEqual(0);
    expect(laneBody).not.toMatch(
      /features\/accessibility|new Map|new Set|Array\.from|\.map\(|\.sort\(|\{\s*center:/,
    );

    const rendererSource = readFileSync(
      join(SRC, "rendering", "DomGridRenderer.ts"),
      "utf8",
    );
    const scrollStart = rendererSource.indexOf(
      "  private readonly onViewportScroll",
    );
    const scrollEnd = rendererSource.indexOf(
      "  constructor(",
      scrollStart,
    );
    const scrollBody = rendererSource.slice(scrollStart, scrollEnd);
    expect(scrollStart).toBeGreaterThanOrEqual(0);
    expect(scrollEnd).toBeGreaterThan(scrollStart);
    expect(scrollBody).not.toContain("forEachRowPinnedLogicalPoolRow");
  });

  it("keeps settled positional paths free of discovery and source/schema scans", () => {
    const rowSource = readFileSync(
      join(PLUGIN, "utils", "rowSemantics.ts"),
      "utf8",
    );
    const rowStart = rowSource.indexOf("  private syncPoolRow(");
    const rowEnd = rowSource.indexOf("  private syncLane(", rowStart);
    const rowLoop = rowSource.slice(rowStart, rowEnd);
    expect(rowStart).toBeGreaterThanOrEqual(0);
    expect(rowEnd).toBeGreaterThan(rowStart);
    expect(rowLoop).not.toMatch(
      /querySelector|querySelectorAll|getSourceRows|getColumns|new Map|new Set|Array\.from|resolveLogicalRowBinding/,
    );
    expect(rowLoop).not.toContain("const elements = [");

    const headerSource = readFileSync(
      join(PLUGIN, "utils", "headerSemantics.ts"),
      "utf8",
    );
    const bindingStart = headerSource.indexOf("  syncBindings(): boolean");
    const bindingEnd = headerSource.indexOf(
      "  syncSort(",
      bindingStart,
    );
    const bindingLoop = headerSource.slice(bindingStart, bindingEnd);
    expect(bindingStart).toBeGreaterThanOrEqual(0);
    expect(bindingEnd).toBeGreaterThan(bindingStart);
    expect(bindingLoop).not.toMatch(
      /querySelector|querySelectorAll|\.children|childNodes|getSourceRows|getColumns|new Map|new Set|Array\.from|\.sort\(/,
    );

    const groupBindingStart = headerSource.indexOf(
      "  private syncGroupBinding(",
    );
    const groupBindingEnd = headerSource.indexOf(
      "  private syncSortModel(",
      groupBindingStart,
    );
    const groupBinding = headerSource.slice(
      groupBindingStart,
      groupBindingEnd,
    );
    expect(groupBindingStart).toBeGreaterThanOrEqual(0);
    expect(groupBindingEnd).toBeGreaterThan(groupBindingStart);
    expect(groupBinding).not.toMatch(
      /querySelector|querySelectorAll|\.children|childNodes|getSourceRows|getColumns|new Map|new Set|Array\.from|\.sort\(/,
    );

    const bodySource = readFileSync(
      join(PLUGIN, "utils", "bodyCellSemantics.ts"),
      "utf8",
    );
    const bodyStart = bodySource.indexOf("  private syncPoolRow(");
    const bodyEnd = bodySource.indexOf(
      "  private resolveCallbackParams(",
      bodyStart,
    );
    const bodyLoop = bodySource.slice(bodyStart, bodyEnd);
    expect(bodyStart).toBeGreaterThanOrEqual(0);
    expect(bodyEnd).toBeGreaterThan(bodyStart);
    expect(bodyLoop).not.toMatch(
      /querySelector|querySelectorAll|getSourceRows|getColumns|new Map|new Set|Array\.from|\.sort\(/,
    );

    const ownershipSource = readFileSync(
      join(PLUGIN, "utils", "pinnedLaneOwnership.ts"),
      "utf8",
    );
    const ownershipStart = ownershipSource.indexOf("  private syncLogicalRow(");
    const ownershipEnd = ownershipSource.indexOf(
      "  private ensureNumberCapacity(",
      ownershipStart,
    );
    const ownershipLoop = ownershipSource.slice(
      ownershipStart,
      ownershipEnd,
    );
    expect(ownershipStart).toBeGreaterThanOrEqual(0);
    expect(ownershipEnd).toBeGreaterThan(ownershipStart);
    expect(ownershipLoop).not.toMatch(
      /querySelector|querySelectorAll|getSourceRows|getColumns|new Map|new Set|Array\.from|\.sort\(/,
    );
  });

  it("131 smoke-checks the current composite-writer manifest with no temporary exceptions", () => {
    const outsidePlugin = productionFiles(SRC).filter(
      (file) => !file.startsWith(PLUGIN + sep),
    );
    const activeDescendant: string[] = [];
    const rowRole: string[] = [];
    const gridCellRole: string[] = [];
    const roleFactoryWriters: string[] = [];
    const forbiddenWriters: string[] = [];

    for (const file of outsidePlugin) {
      const source = readFileSync(file, "utf8");
      const path = relative(SRC, file).split(sep).join("/");
      if (/["']aria-activedescendant["']/.test(source)) {
        activeDescendant.push(path);
      }
      if (/setAttribute\(["']role["'],\s*["']row["']\)/.test(source)) {
        rowRole.push(path);
      }
      if (
        /createDiv\([^,\n]+,\s*["']row["']/.test(source)
      ) {
        rowRole.push(path);
      }
      if (
        /setAttribute\(["']role["'],\s*["']gridcell["']\)/.test(source) ||
        /createDiv\([^,\n]+,\s*["']gridcell["']/.test(source)
      ) {
        gridCellRole.push(path);
      }
      if (
        /\bcreateDiv\s*\(\s*[^,\n]+,\s*["'](?:grid|treegrid|rowgroup|row|gridcell|columnheader|presentation)["']/.test(
          source,
        )
      ) {
        roleFactoryWriters.push(path);
      }
      if (
        /setAttribute\(["']role["'],\s*["']grid["']\)|setAttribute\(["']aria-(?:selected|sort)["']|createDiv\([^,\n]+,\s*["']columnheader["']/.test(
          source,
        )
      ) {
        forbiddenWriters.push(path);
      }
    }

    expect(activeDescendant).toEqual([]);
    expect(rowRole).toEqual([]);
    expect(gridCellRole).toEqual([]);
    expect(roleFactoryWriters).toEqual([]);
    expect(forbiddenWriters).toEqual([]);
  });
});
