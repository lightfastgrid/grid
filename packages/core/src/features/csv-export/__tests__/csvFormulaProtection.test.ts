import { describe, expect, it } from "vitest";

import {
  applyCsvFormulaProtection,
  isFormulaRisky,
} from "../csvFormulaProtection";

describe("csvFormulaProtection - risky detection", () => {
  it.each(["=SUM(A1)", "+1", "-1", "@cmd", "\tx", "\rx"])(
    "flags leading risky char %j",
    (value) => {
      expect(isFormulaRisky(value)).toBe(true);
    },
  );

  it.each([" =x", "  +y", "   @z", " -3"])(
    "flags leading spaces before a risky char %j",
    (value) => {
      expect(isFormulaRisky(value)).toBe(true);
    },
  );

  it.each(["abc", "3+4", "a=b", "", "   ", "n-name"])(
    "does not flag safe value %j",
    (value) => {
      expect(isFormulaRisky(value)).toBe(false);
    },
  );
});

describe("csvFormulaProtection - Unicode leading whitespace", () => {
  it.each([
    "\n=cmd",
    " \n=cmd",
    "\f+1",
    "\v-1",
    "\u00a0@cmd", // no-break space
    "\u2003=cmd", // em space (Zs)
    "\u3000-1", // ideographic space (Zs)
  ])("flags a risky char after leading whitespace %j", (value) => {
    expect(isFormulaRisky(value)).toBe(true);
  });

  it.each(["   ", "\t", "\n", "\u00a0", "\u2003", "\t\n \f"])(
    "treats whitespace-only string %j as safe",
    (value) => {
      expect(isFormulaRisky(value)).toBe(false);
    },
  );

  it.each(["a\t=b", "x =SUM", "col\nname", "a =b"])(
    "treats non-leading internal whitespace %j as safe",
    (value) => {
      expect(isFormulaRisky(value)).toBe(false);
    },
  );
});

describe("csvFormulaProtection - escape mode", () => {
  it.each(["=SUM(A1)", "+1", "-1", "@cmd", "\tx", "\rx", " =x"])(
    "prefixes risky string %j with a single quote",
    (value) => {
      expect(applyCsvFormulaProtection(value, "escape")).toBe(`'${value}`);
    },
  );

  it("escapes a formatter/callback-produced string like -42", () => {
    expect(applyCsvFormulaProtection("-42", "escape")).toBe("'-42");
  });

  it.each([
    [-42, -42],
    [-42n, -42n],
    [42, 42],
    [true, true],
    [false, false],
    [null, null],
    [undefined, undefined],
  ])("never escapes native %p", (input, expected) => {
    expect(applyCsvFormulaProtection(input, "escape")).toBe(expected);
  });

  it("leaves safe strings unchanged", () => {
    expect(applyCsvFormulaProtection("abc", "escape")).toBe("abc");
  });
});

describe("csvFormulaProtection - none mode", () => {
  it("is an explicit opt-out that never escapes", () => {
    expect(applyCsvFormulaProtection("=danger", "none")).toBe("=danger");
    expect(applyCsvFormulaProtection("-42", "none")).toBe("-42");
  });
});
