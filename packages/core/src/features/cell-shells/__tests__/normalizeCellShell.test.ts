import { describe, expect, it } from "vitest";

import type { CellShellConfig } from "../cellShellTypes";
import { normalizeCellShell } from "../normalizeCellShell";

describe("normalizeCellShell", () => {
  it("returns undefined for undefined input", () => {
    expect(normalizeCellShell(undefined)).toBeUndefined();
  });

  it('normalizes "badge" shorthand to { kind: "badge" }', () => {
    expect(normalizeCellShell("badge")).toEqual({ kind: "badge" });
  });

  it('normalizes "button" shorthand to { kind: "button" }', () => {
    expect(normalizeCellShell("button")).toEqual({ kind: "button" });
  });

  it("preserves an object config unchanged", () => {
    const config: CellShellConfig = {
      kind: "iconText",
      icon: "star",
      text: "value",
      overlay: {
        key: "details",
        trigger: "click",
        placement: "bottom-start",
      },
    };
    expect(normalizeCellShell(config)).toBe(config);
  });

  it("does not mutate the input object", () => {
    const config: CellShellConfig = {
      kind: "progress",
      className: "my-bar",
    };
    const before = JSON.stringify(config);
    normalizeCellShell(config);
    expect(JSON.stringify(config)).toBe(before);
  });
});
