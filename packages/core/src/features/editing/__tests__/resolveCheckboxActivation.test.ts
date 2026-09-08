import { describe, expect, it, vi } from "vitest";

import type {
  CellShellConfig,
  CheckboxActivation,
  ColumnDef,
  TextCellEditorConfig,
} from "../../../types";
import {
  hasBuiltInCheckboxShell,
  resolveCheckboxActivation,
} from "../resolveCheckboxActivation";
import { resolveEditor } from "../resolveEditor";

function col(overrides: Partial<ColumnDef> = {}): ColumnDef {
  return { field: "bought", ...overrides };
}

const IMAGE_SHELL: CellShellConfig = {
  kind: "image",
  image: { src: "formattedValue" },
};

describe("editor-kind inference and precedence (architecture 5.3.3)", () => {
  // Test 1
  it("an explicit checkbox editor resolves to checkbox for any value", () => {
    const c = col({ editor: { type: "checkbox" } });
    for (const v of [true, false, null, undefined, "x", 0, {}]) {
      expect(resolveEditor(c, v).kind).toBe("checkbox");
    }
  });

  // Test 2
  it('the "boolean" editor alias resolves to checkbox', () => {
    expect(resolveEditor(col({ editor: { type: "boolean" } }), null).kind).toBe(
      "checkbox",
    );
    expect(resolveEditor(col({ editor: "boolean" }), null).kind).toBe("checkbox");
  });

  // Tests 3-6: checkbox shell is a type signal for every boolean-ish value
  it.each([
    ["true", true],
    ["false", false],
    ["null", null],
    ["undefined", undefined],
  ])("cellShell checkbox infers checkbox when value is %s", (_label, value) => {
    expect(resolveEditor(col({ cellShell: "checkbox" }), value).kind).toBe(
      "checkbox",
    );
  });

  // Test 7
  it("object-form checkbox shell behaves identically to the string form", () => {
    const objForm = col({ cellShell: { kind: "checkbox" } });
    const strForm = col({ cellShell: "checkbox" });
    expect(resolveEditor(objForm, null).kind).toBe(
      resolveEditor(strForm, null).kind,
    );
    expect(resolveEditor(objForm, null).kind).toBe("checkbox");
  });

  // Test 8
  it("an explicit non-checkbox editor wins over the checkbox shell signal", () => {
    expect(
      resolveEditor(col({ editor: { type: "text" }, cellShell: "checkbox" }), true)
        .kind,
    ).toBe("text");
    expect(
      resolveEditor(col({ editor: "number", cellShell: "checkbox" }), true).kind,
    ).toBe("number");
    expect(
      resolveEditor(
        col({ editor: { type: "select", options: ["a"] }, cellShell: "checkbox" }),
        true,
      ).kind,
    ).toBe("select");
  });

  // Test 9
  it("without an editor or checkbox shell, value-based inference is unchanged", () => {
    expect(resolveEditor(col(), true).kind).toBe("checkbox");
    expect(resolveEditor(col(), 5).kind).toBe("number");
    expect(resolveEditor(col(), "2024-01-01").kind).toBe("date");
    expect(resolveEditor(col(), "plain").kind).toBe("text");
    expect(resolveEditor(col(), null).kind).toBe("text");
    expect(resolveEditor(col({ cellShell: IMAGE_SHELL }), null).kind).toBe("text");
  });
});

describe("resolveCheckboxActivation (architecture 5.3.4)", () => {
  // Test 10
  it('"toggle" with a string checkbox shell resolves to toggle', () => {
    expect(resolveCheckboxActivation("toggle", col({ cellShell: "checkbox" }))).toBe(
      "toggle",
    );
  });

  // Test 11
  it('"toggle" with an object checkbox shell resolves to toggle', () => {
    expect(
      resolveCheckboxActivation("toggle", col({ cellShell: { kind: "checkbox" } })),
    ).toBe("toggle");
  });

  // Test 12 — strict control-only fail-safe
  it('"toggle" without the checkbox shell fails safe to edit', () => {
    expect(resolveCheckboxActivation("toggle", col())).toBe("edit");
    expect(resolveCheckboxActivation("toggle", col({ cellShell: IMAGE_SHELL }))).toBe(
      "edit",
    );
    expect(resolveCheckboxActivation("toggle", col({ cellShell: "badge" }))).toBe(
      "edit",
    );
  });

  // Test 13
  it('"edit" resolves to edit regardless of presentation', () => {
    expect(resolveCheckboxActivation("edit", col({ cellShell: "checkbox" }))).toBe(
      "edit",
    );
    expect(resolveCheckboxActivation("edit", col())).toBe("edit");
  });

  // Test 14
  it('"auto" with the checkbox shell resolves to toggle', () => {
    expect(resolveCheckboxActivation("auto", col({ cellShell: "checkbox" }))).toBe(
      "toggle",
    );
  });

  // Test 15
  it('"auto" with a non-checkbox shell resolves to edit', () => {
    expect(resolveCheckboxActivation("auto", col({ cellShell: IMAGE_SHELL }))).toBe(
      "edit",
    );
    expect(resolveCheckboxActivation("auto", col({ cellShell: "badge" }))).toBe(
      "edit",
    );
  });

  // Test 16
  it('"auto" with no cellShell resolves to edit (bare boolean columns are edit-gated)', () => {
    expect(resolveCheckboxActivation("auto", col())).toBe("edit");
  });

  // Test 17
  it("omitted activation behaves exactly as auto", () => {
    expect(resolveCheckboxActivation(undefined, col({ cellShell: "checkbox" }))).toBe(
      resolveCheckboxActivation("auto", col({ cellShell: "checkbox" })),
    );
    expect(resolveCheckboxActivation(undefined, col())).toBe(
      resolveCheckboxActivation("auto", col()),
    );
  });

  // Test 18 — out-of-union runtime value, injected without a cast
  it("an out-of-union activation value is treated as auto", () => {
    const holder: { activation?: CheckboxActivation } = {};
    Reflect.set(holder, "activation", "TOGGLE!");
    expect(
      resolveCheckboxActivation(holder.activation, col({ cellShell: "checkbox" })),
    ).toBe("toggle");
    expect(resolveCheckboxActivation(holder.activation, col())).toBe("edit");
  });

  // Test 19 — no runtime warnings on any path
  it("emits no console warning or error for any input", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const columns = [
        col(),
        col({ cellShell: "checkbox" }),
        col({ cellShell: IMAGE_SHELL }),
      ];
      const holder: { activation?: CheckboxActivation } = {};
      const inputs: (CheckboxActivation | undefined)[] = [
        undefined,
        "auto",
        "toggle",
        "edit",
      ];
      Reflect.set(holder, "activation", "nonsense");
      inputs.push(holder.activation);

      for (const c of columns) {
        for (const a of inputs) {
          resolveCheckboxActivation(a, c);
          resolveEditor(c, null);
        }
      }
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  // Test 20 — purity and no retained state. The allocation half of Test 20 is
  // proven structurally in
  // `src/__tests__/contracts/booleanCellAllocationGuard.test.ts`; this asserts
  // referential stability and absence of retained state.
  it("is pure: repeated calls are stable and nothing is retained", () => {
    const c = col({ cellShell: "checkbox" });
    const frozen = Object.freeze({ ...c });
    const first = resolveCheckboxActivation("auto", frozen);
    for (let i = 0; i < 100; i++) {
      expect(resolveCheckboxActivation("auto", frozen)).toBe(first);
    }
    expect(hasBuiltInCheckboxShell(frozen)).toBe(true);
    // The column object is never mutated.
    expect(Object.keys(frozen)).toEqual(Object.keys(c));
  });

  it("hasBuiltInCheckboxShell only matches the built-in checkbox presentation", () => {
    expect(hasBuiltInCheckboxShell(col({ cellShell: "checkbox" }))).toBe(true);
    expect(hasBuiltInCheckboxShell(col({ cellShell: { kind: "checkbox" } }))).toBe(
      true,
    );
    expect(hasBuiltInCheckboxShell(col())).toBe(false);
    expect(hasBuiltInCheckboxShell(col({ cellShell: IMAGE_SHELL }))).toBe(false);
    expect(hasBuiltInCheckboxShell(col({ cellShell: "text" }))).toBe(false);
  });
});

describe("normalized activation plumbing", () => {
  it("activation survives normalization on a checkbox editor", () => {
    expect(
      resolveEditor(col({ editor: { type: "checkbox", activation: "edit" } }), true)
        .activation,
    ).toBe("edit");
    expect(
      resolveEditor(col({ editor: { type: "boolean", activation: "toggle" } }), true)
        .activation,
    ).toBe("toggle");
  });

  it("activation is undefined for non-checkbox editors even if injected at runtime", () => {
    // Start from a valid text editor, then inject the checkbox-only option.
    const editor: TextCellEditorConfig = { type: "text" };
    Reflect.set(editor, "activation", "toggle");
    expect(resolveEditor(col({ editor }), "x").activation).toBeUndefined();
  });
});
