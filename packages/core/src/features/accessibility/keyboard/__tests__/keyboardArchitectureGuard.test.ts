import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "../../../..");
const ACCESSIBILITY = join(SRC, "features", "accessibility");

function productionFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "__tests__") continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...productionFiles(path));
    else if (/\.tsx?$/.test(entry)) files.push(path);
  }
  return files;
}

function source(path: string): string {
  return readFileSync(join(SRC, path), "utf8");
}

function relativeSource(path: string): string {
  return relative(SRC, path).split(sep).join("/");
}

describe("Accessibility V2 keyboard architecture guards", () => {
  it("185-186: topology dirtiness is structural and ordinary feature events stay positional", () => {
    const updates = source(
      "features/accessibility/subscribeAccessibilityUpdates.ts",
    );
    expect(updates).toMatch(
      /const COLUMN_TOPOLOGY_EVENTS = \[[\s\S]*"columns:updated"[\s\S]*"column-order:changed"[\s\S]*"column-pin:changed"[\s\S]*"column-visibility:changed"/,
    );
    for (const event of [
      "selection:changed",
      "column-selection:changed",
      "sort:changed",
      "column-menu:changed",
    ]) {
      const start = updates.indexOf(`grid.on("${event}"`);
      const end = updates.indexOf("),", start);
      expect(start, event).toBeGreaterThanOrEqual(0);
      expect(updates.slice(start, end), event).not.toContain(
        "ACCESSIBILITY_DIRTY_HEADER_TOPOLOGY",
      );
    }
  });

  it("187: renderer scroll, virtualization, pooling, and population remain keyboard-unaware", () => {
    const hotPaths = [
      "rendering/DomGridRenderer.ts",
      "rendering/ring-buffer/VirtualWindowSync.ts",
      "rendering/dom/DomPoolManager.ts",
      "rendering/helpers/populateRow.ts",
    ];
    const forbidden = /accessibility|keyboard/i;
    for (const path of hotPaths) {
      expect(source(path), path).not.toMatch(forbidden);
    }
  });

  it("188: registry remains the only production importer of the accessibility feature", () => {
    const importers = productionFiles(SRC)
      .filter((path) => !path.startsWith(ACCESSIBILITY))
      .filter((path) =>
        /from\s+["'][^"']*accessibility(?:\/index)?["']/.test(
          readFileSync(path, "utf8"),
        ),
      )
      .map(relativeSource);
    expect(importers).toEqual(["features/registry.ts"]);
  });

  it("189: owner features expose neutral commands without importing keyboard policy", () => {
    const ownerDirectories = [
      "cell-menu",
      "column-menu",
      "column-order",
      "column-selection",
      "editing",
      "filters",
      "focus",
      "menu",
      "resize",
      "row-order",
      "selection",
      "sort",
      "tooltips",
    ];
    const offenders = ownerDirectories.flatMap((directory) =>
      productionFiles(join(SRC, "features", directory))
        .filter((path) =>
          /accessibility\/keyboard|KeyboardNavigation|KeyboardTargetState|resolveKeyboardNavigation/.test(
            readFileSync(path, "utf8"),
          ),
        )
        .map(relativeSource),
    );
    expect(offenders).toEqual([]);
  });

  it("190: accessibility is the sole production grid-navigation keydown owner", () => {
    const keyboard = source(
      "features/accessibility/keyboard/KeyboardNavigationController.ts",
    );
    expect(keyboard.match(/addEventListener\("keydown"/g)).toHaveLength(2);
    expect(keyboard.match(/removeEventListener\("keydown"/g)).toHaveLength(2);
    expect(keyboard).toContain(
      'this.externalBodyWidget?.removeEventListener("keydown", this.onKeyDown)',
    );
    expect(keyboard).toContain(
      'widget?.addEventListener("keydown", this.onKeyDown)',
    );
    expect(source("features/focus/FocusController.ts")).not.toMatch(
      /addEventListener\("keydown"/,
    );
    expect(source("features/input/GridInputController.ts")).not.toMatch(
      /addEventListener\("keydown"/,
    );
    expect(source("features/editing/editingFeature.ts")).toContain(
      "keyboardNavigation: false",
    );
  });

  it("keeps the visible active-target marker plugin-owned and out of hot paths", () => {
    const keyboard = source(
      "features/accessibility/keyboard/KeyboardNavigationController.ts",
    );
    const theme = source("themes/default.css");
    expect(keyboard).toContain('"lfg-a11y-active-target"');
    expect(keyboard).toContain('"lfg-keyboard-focus"');
    expect(theme).toMatch(
      /\.lfg-grid-surface:focus-visible:not\(\[aria-activedescendant\]\)/,
    );
    expect(theme).toMatch(
      /\.lfg-grid-surface\.lfg-keyboard-focus:focus:not\(\[aria-activedescendant\]\)/,
    );
    expect(theme).not.toMatch(
      /\.lfg-grid-surface:focus-visible\s*\{\s*outline:/,
    );
    expect(theme).toMatch(
      /\.lfg-grid-surface:focus-visible \.lfg-a11y-active-target/,
    );
    expect(theme).toMatch(
      /\.lfg-grid-surface\.lfg-keyboard-focus:focus \.lfg-a11y-active-target/,
    );
    expect(theme).toMatch(
      /\.lfg-grid-surface\.lfg-keyboard-focus:focus\[aria-activedescendant\]\s+\.lfg-cell\.lfg-cell-focused:not\(\.lfg-a11y-active-target\)\s*\{\s*box-shadow:\s*none;/,
    );
    expect(theme).toMatch(
      /\.lfg-grid:focus-within\s+\.lfg-grid-surface:not\(:focus\)\s+\.lfg-cell\.lfg-cell-focused\s*\{\s*box-shadow:\s*none;/,
    );
    expect(theme).toMatch(/@media \(forced-colors: active\)/);

    for (const path of [
      "rendering/DomGridRenderer.ts",
      "rendering/ring-buffer/VirtualWindowSync.ts",
      "rendering/dom/DomPoolManager.ts",
      "rendering/helpers/populateRow.ts",
    ]) {
      expect(source(path), path).not.toContain("lfg-a11y-active-target");
    }
  });

  it("220: exact binding validation stays O(1) behind the neutral focus seam", () => {
    const binding = source(
      "features/accessibility/keyboard/isKeyboardTargetElementBound.ts",
    );
    expect(binding).not.toMatch(
      /querySelector|closest\(|getBoundingClientRect|offset(?:Left|Top|Width|Height)|client(?:Width|Height)|scroll(?:Left|Top)/,
    );
    expect(binding).not.toMatch(/new (?:Array|Map|Set)\b|\.\.\./);

    const keyboard = source(
      "features/accessibility/keyboard/KeyboardNavigationController.ts",
    );
    const validation = keyboard.slice(
      keyboard.indexOf("syncExactFocusBinding(): void"),
      keyboard.indexOf("publishBodyFocus(): boolean"),
    );
    expect(validation).not.toMatch(
      /querySelector|closest\(|getBoundingClientRect|offset(?:Left|Top|Width|Height)|client(?:Width|Height)|scroll(?:Left|Top)|new (?:Array|Map|Set)\b|\.\.\./,
    );
    expect(keyboard).not.toMatch(/addEventListener\("scroll"/);

    const host = source("rendering/dom/DomFeatureHost.ts");
    const focusSync = host.slice(
      host.indexOf("syncFocusState(): void"),
      host.indexOf("syncOverlays(): void"),
    );
    expect(focusSync).toMatch(
      /focusCapability\?\.syncFocusState\(\);[\s\S]*exactFocusBindingCapability\?\.syncExactFocusBinding\(\);/,
    );

    for (const path of [
      "rendering/DomGridRenderer.ts",
      "rendering/ring-buffer/VirtualWindowSync.ts",
      "rendering/dom/DomPoolManager.ts",
      "rendering/helpers/populateRow.ts",
    ]) {
      expect(source(path), path).not.toContain("syncExactFocusBinding");
    }
  });
});
