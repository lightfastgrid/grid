// @vitest-environment jsdom

/**
 * Boolean Cell V1 — Test 38.
 *
 * Drives the real `CellShellManager` (not the resolver in isolation) to prove
 * mapped sources work for `text`, `image.src`, and `image.alt`.
 *
 * Test 36 (allocation) is proven structurally in
 * `src/__tests__/contracts/booleanCellAllocationGuard.test.ts`; runtime
 * monkey-patching cannot detect object/array/closure literals.
 */

import { describe, expect, it } from "vitest";

import type { PooledCell } from "../../../internal/poolTypes";
import { bindCellShell } from "../CellShellManager";
import type { CellShellConfig } from "../cellShellTypes";

const CHECKED = "https://cdn.example/checked.svg";
const UNCHECKED = "https://cdn.example/unchecked.svg";

function makeCell(): PooledCell {
  return { element: document.createElement("div"), value: "" };
}

function params(value: unknown, formattedValue: string) {
  return {
    row: { bought: value, status: "ok" },
    rowId: "r1",
    rowIndex: 0,
    column: { field: "bought" },
    field: "bought",
    value,
    formattedValue,
  };
}

// ── Test 38: mapped sources through the real CellShellManager ─────────

describe("mapped sources through CellShellManager (Test 38)", () => {
  it("text shell renders a mapped label from the raw boolean", () => {
    const config: CellShellConfig = {
      kind: "text",
      text: { from: "value", map: { true: "Purchased", false: "Not purchased" } },
    };

    const on = makeCell();
    bindCellShell(on, params(true, "IGNORED-FORMATTED"), config);
    expect(
      on.shellRoot!.querySelector(".lfg-cell-shell-label")!.textContent,
    ).toBe("Purchased");

    const off = makeCell();
    bindCellShell(off, params(false, "IGNORED-FORMATTED"), config);
    expect(
      off.shellRoot!.querySelector(".lfg-cell-shell-label")!.textContent,
    ).toBe("Not purchased");
  });

  it("image shell renders mapped src and alt from the raw boolean", () => {
    const config: CellShellConfig = {
      kind: "image",
      image: {
        src: { from: "value", map: { true: CHECKED, false: UNCHECKED } },
        alt: { from: "value", map: { true: "Purchased", false: "Not purchased" } },
      },
    };

    const on = makeCell();
    bindCellShell(on, params(true, "Purchased"), config);
    const onImg = on.shellRoot!.querySelector("img")!;
    expect(onImg.getAttribute("src")).toBe(CHECKED);
    expect(onImg.getAttribute("alt")).toBe("Purchased");

    const off = makeCell();
    bindCellShell(off, params(false, "Not purchased"), config);
    const offImg = off.shellRoot!.querySelector("img")!;
    expect(offImg.getAttribute("src")).toBe(UNCHECKED);
    expect(offImg.getAttribute("alt")).toBe("Not purchased");
  });

  it("the asset URL never reaches the formatted-value text channel (V-1)", () => {
    const config: CellShellConfig = {
      kind: "image",
      image: {
        src: { from: "value", map: { true: CHECKED, false: UNCHECKED } },
        alt: { from: "value", map: { true: "Purchased", false: "Not purchased" } },
      },
    };
    const cell = makeCell();
    // The formatted value is human text; the URL comes only from the map.
    bindCellShell(cell, params(true, "Purchased"), config);

    const img = cell.shellRoot!.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(CHECKED);
    // No text node anywhere in the shell contains the URL.
    expect(cell.shellRoot!.textContent).not.toContain("cdn.example");
    expect(img.getAttribute("alt")).not.toContain("cdn.example");
  });

  it("a mapped source with a missing key falls back through the manager", () => {
    const config: CellShellConfig = {
      kind: "image",
      image: {
        src: { from: "value", map: { true: CHECKED }, fallback: "" },
        alt: { from: "value", map: { true: "Purchased" }, fallback: "Unknown" },
      },
    };
    const cell = makeCell();
    bindCellShell(cell, params(false, "Not purchased"), config);

    const img = cell.shellRoot!.querySelector("img")!;
    // Empty src hides the image, matching existing image-shell behavior.
    expect(img.hasAttribute("src")).toBe(false);
    expect(img.hidden).toBe(true);

    // Alt fallback is observable when src still resolves.
    const altFallbackConfig: CellShellConfig = {
      kind: "image",
      image: {
        src: {
          from: "value",
          map: { true: CHECKED, false: UNCHECKED },
        },
        alt: { from: "value", map: { true: "Purchased" }, fallback: "Unknown" },
      },
    };
    bindCellShell(cell, params(false, "Not purchased"), altFallbackConfig);
    const rebound = cell.shellRoot!.querySelector("img")!;
    expect(rebound.getAttribute("src")).toBe(UNCHECKED);
    expect(rebound.getAttribute("alt")).toBe("Unknown");
  });

  it("rebinding a pooled cell updates mapped src and alt without stale state", () => {
    const config: CellShellConfig = {
      kind: "image",
      image: {
        src: { from: "value", map: { true: CHECKED, false: UNCHECKED } },
        alt: { from: "value", map: { true: "Purchased", false: "Not purchased" } },
      },
    };
    const cell = makeCell();

    bindCellShell(cell, params(true, "Purchased"), config);
    expect(cell.shellRoot!.querySelector("img")!.getAttribute("src")).toBe(CHECKED);

    // Same physical cell, new row value.
    bindCellShell(cell, params(false, "Not purchased"), config);
    const img = cell.shellRoot!.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(UNCHECKED);
    expect(img.getAttribute("alt")).toBe("Not purchased");
  });

  // A-6 at the real manager boundary (architecture Test 38).
  // Test 35 proves resolver isolation only; this proves CellShellManager itself
  // treats deeply frozen mapped configuration as read-only across bind/rebind.
  it("deeply frozen mapped text and image configs survive bind/rebind with stable identities (A-6)", () => {
    const textMap = Object.freeze({ true: "Purchased", false: "Not purchased" });
    const textSource = Object.freeze({
      from: "value" as const,
      map: textMap,
    });
    const textConfig = Object.freeze({
      kind: "text" as const,
      text: textSource,
    }) as CellShellConfig;

    const srcMap = Object.freeze({ true: CHECKED, false: UNCHECKED });
    const altMap = Object.freeze({ true: "Purchased", false: "Not purchased" });
    const srcSource = Object.freeze({ from: "value" as const, map: srcMap });
    const altSource = Object.freeze({ from: "value" as const, map: altMap });
    const imageSlot = Object.freeze({ src: srcSource, alt: altSource });
    const imageConfig = Object.freeze({
      kind: "image" as const,
      image: imageSlot,
    }) as CellShellConfig;

    const textConfigRef = textConfig;
    const imageConfigRef = imageConfig;

    const textCell = makeCell();
    const rowOn = { bought: true as unknown, status: "ok" };
    const rowOnSnapshot = JSON.stringify(rowOn);
    bindCellShell(
      textCell,
      { ...params(true, "IGNORED"), row: rowOn },
      textConfig,
    );
    const textRoot = textCell.shellRoot;
    expect(textRoot).toBeTruthy();
    expect(
      textRoot!.querySelector(".lfg-cell-shell-label")!.textContent,
    ).toBe("Purchased");
    expect(JSON.stringify(rowOn)).toBe(rowOnSnapshot);

    const rowOff = { bought: false as unknown, status: "ok" };
    const rowOffSnapshot = JSON.stringify(rowOff);
    bindCellShell(
      textCell,
      { ...params(false, "IGNORED"), row: rowOff },
      textConfig,
    );
    // Same pooled shell root; only the resolved label changes.
    expect(textCell.shellRoot).toBe(textRoot);
    expect(
      textCell.shellRoot!.querySelector(".lfg-cell-shell-label")!.textContent,
    ).toBe("Not purchased");
    expect(JSON.stringify(rowOff)).toBe(rowOffSnapshot);

    const imageCell = makeCell();
    bindCellShell(imageCell, params(true, "Purchased"), imageConfig);
    const imageRoot = imageCell.shellRoot;
    const imageImg = imageCell.shellRoot!.querySelector("img");
    expect(imageRoot).toBeTruthy();
    expect(imageImg).toBeTruthy();
    expect(imageImg!.getAttribute("src")).toBe(CHECKED);
    expect(imageImg!.getAttribute("alt")).toBe("Purchased");
    bindCellShell(imageCell, params(false, "Not purchased"), imageConfig);
    expect(imageCell.shellRoot).toBe(imageRoot);
    expect(imageCell.shellRoot!.querySelector("img")).toBe(imageImg);
    expect(imageImg!.getAttribute("src")).toBe(UNCHECKED);
    expect(imageImg!.getAttribute("alt")).toBe("Not purchased");

    // Config, nested sources, maps, and their identities are unchanged.
    expect(textConfig).toBe(textConfigRef);
    expect(textConfig.kind).toBe("text");
    expect(textConfig.text).toBe(textSource);
    expect(textSource.map).toBe(textMap);
    expect(Object.isFrozen(textConfig)).toBe(true);
    expect(Object.isFrozen(textSource)).toBe(true);
    expect(Object.isFrozen(textMap)).toBe(true);
    expect({ ...textMap }).toEqual({ true: "Purchased", false: "Not purchased" });

    expect(imageConfig).toBe(imageConfigRef);
    expect(imageConfig.kind).toBe("image");
    expect(imageConfig.image).toBe(imageSlot);
    expect(imageSlot.src).toBe(srcSource);
    expect(imageSlot.alt).toBe(altSource);
    expect(srcSource.map).toBe(srcMap);
    expect(altSource.map).toBe(altMap);
    expect(Object.isFrozen(imageConfig)).toBe(true);
    expect(Object.isFrozen(imageSlot)).toBe(true);
    expect(Object.isFrozen(srcSource)).toBe(true);
    expect(Object.isFrozen(altSource)).toBe(true);
    expect(Object.isFrozen(srcMap)).toBe(true);
    expect(Object.isFrozen(altMap)).toBe(true);
    expect({ ...srcMap }).toEqual({ true: CHECKED, false: UNCHECKED });
    expect({ ...altMap }).toEqual({ true: "Purchased", false: "Not purchased" });
  });
});
