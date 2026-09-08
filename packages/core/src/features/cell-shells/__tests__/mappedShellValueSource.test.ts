import { describe, expect, it, vi } from "vitest";

import type {
  CellShellMappedValueSource,
  CellShellValueSource,
} from "../cellShellTypes";
import type { ShellValueContext } from "../resolveShellValue";
import { resolveShellTone, resolveShellValue } from "../resolveShellValue";

function ctx(overrides: Partial<ShellValueContext> = {}): ShellValueContext {
  return {
    value: true,
    formattedValue: "Purchased",
    row: { bought: true, other: "x" },
    ...overrides,
  };
}

/**
 * Install an arbitrary runtime value into a slot typed as `CellShellValueSource`
 * without a cast, so malformed-wrapper cases stay assertion-free.
 */
function sourceHolder(value: object): CellShellValueSource {
  const holder: { source: CellShellValueSource } = { source: "formattedValue" };
  Reflect.set(holder, "source", value);
  return holder.source;
}

const CHECKED = "https://cdn.example/checked.svg";
const UNCHECKED = "https://cdn.example/unchecked.svg";

const boolMap: CellShellMappedValueSource = {
  from: "value",
  map: { true: CHECKED, false: UNCHECKED },
};

describe("mapped CellShellValueSource", () => {
  // Test 24
  it("resolves true/false keys to their mapped strings", () => {
    expect(resolveShellValue(boolMap, ctx({ value: true }))).toBe(CHECKED);
    expect(resolveShellValue(boolMap, ctx({ value: false }))).toBe(UNCHECKED);
  });

  // Test 25
  it("a missing key returns fallback, or empty string when absent", () => {
    const withFallback: CellShellMappedValueSource = {
      map: { true: CHECKED },
      fallback: "FB",
    };
    expect(resolveShellValue(withFallback, ctx({ value: false }))).toBe("FB");
    expect(resolveShellValue({ map: { true: CHECKED } }, ctx({ value: false }))).toBe(
      "",
    );
  });

  // Test 26
  it("null and undefined bypass the map entirely", () => {
    const withNullKey: CellShellMappedValueSource = {
      map: { null: "NULL-KEY", undefined: "UNDEF-KEY", "": "EMPTY-KEY" },
      fallback: "FB",
    };
    expect(resolveShellValue(withNullKey, ctx({ value: null }))).toBe("FB");
    expect(resolveShellValue(withNullKey, ctx({ value: undefined }))).toBe("FB");
    // Without a fallback, nullish yields "" — still never a map hit.
    expect(
      resolveShellValue({ map: { null: "NULL-KEY" } }, ctx({ value: null })),
    ).toBe("");
  });

  // Tests 27-28: only a plain object (Object.prototype or null prototype) is a
  // valid map. Malformed runtime values are injected with Reflect.set onto a
  // typed, valid fixture rather than through a cast.
  it.each([
    ["a string", "nope"],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
    ["a boolean", true],
    ["an array", ["a", "b"]],
    ["a Date instance", new Date()],
    ["a function", () => "x"],
    ["a class instance", new (class Holder { true = "leaked"; })()],
    ["a Map instance", new Map([["true", "leaked"]])],
  ])("a map that is %s degrades silently to fallback", (_label, malformed) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const source: CellShellMappedValueSource = {
        from: "value",
        map: { true: CHECKED },
        fallback: "FB",
      };
      Reflect.set(source, "map", malformed);
      expect(resolveShellValue(source, ctx({ value: true }))).toBe("FB");

      const noFallback: CellShellMappedValueSource = {
        from: "value",
        map: { true: CHECKED },
      };
      Reflect.set(noFallback, "map", malformed);
      expect(resolveShellValue(noFallback, ctx({ value: true }))).toBe("");

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("an object with a non-Object prototype is not a valid map", () => {
    // Prototype chain carries the key, but the object itself is not plain.
    const exotic = Object.create({ true: "inherited" }) as Record<string, string>;
    const source: CellShellMappedValueSource = {
      from: "value",
      map: { true: CHECKED },
      fallback: "FB",
    };
    Reflect.set(source, "map", exotic);
    expect(resolveShellValue(source, ctx({ value: true }))).toBe("FB");
  });

  // Test 29
  it("a non-string map entry is treated as missing", () => {
    const source: CellShellMappedValueSource = {
      from: "value",
      map: { true: CHECKED },
      fallback: "FB",
    };
    for (const bad of [123, null, undefined, {}, [], true]) {
      Reflect.set(source.map, "true", bad);
      expect(resolveShellValue(source, ctx({ value: true }))).toBe("FB");
    }
  });

  // Test 30
  it("inherited prototype keys never match", () => {
    const src: CellShellMappedValueSource = {
      from: "value",
      map: {},
      fallback: "FB",
    };
    expect(resolveShellValue(src, ctx({ value: "toString" }))).toBe("FB");
    expect(resolveShellValue(src, ctx({ value: "constructor" }))).toBe("FB");
    expect(resolveShellValue(src, ctx({ value: "hasOwnProperty" }))).toBe("FB");
  });

  // Test 31
  it("a null-prototype map resolves normally", () => {
    const map = Object.create(null) as Record<string, string>;
    map.true = CHECKED;
    expect(resolveShellValue({ from: "value", map }, ctx({ value: true }))).toBe(
      CHECKED,
    );
    expect(
      resolveShellValue({ from: "value", map, fallback: "FB" }, ctx({ value: false })),
    ).toBe("FB");
  });

  // ── Wrapper prototype boundary (Tests 27-28 extension) ───────────────
  //
  // A mapped source is recognized only when the WRAPPER is a plain object and
  // `map` is its OWN property. `"map" in wrapper` would walk the prototype
  // chain and resolve inherited content.

  it("a wrapper with an inherited map is not a mapped source", () => {
    const donor = { map: { true: "LEAKED" }, fallback: "LEAKED-FB" };
    const wrapper = Object.create(donor) as CellShellMappedValueSource;
    // Sanity: the property is visible through the chain but is not own.
    expect("map" in wrapper).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(wrapper, "map")).toBe(false);

    // Fails closed: falls through to base-source handling, never resolves
    // the inherited map.
    expect(resolveShellValue(wrapper, ctx({ value: true }))).toBe("Purchased");
  });

  it("a class instance with an own map is not a mapped source", () => {
    class MappedLike {
      map = { true: "LEAKED" };
      fallback = "LEAKED-FB";
    }
    const wrapper = new MappedLike();
    // Own property, but the wrapper is not a plain object.
    expect(Object.prototype.hasOwnProperty.call(wrapper, "map")).toBe(true);
    expect(resolveShellValue(sourceHolder(wrapper), ctx({ value: true }))).toBe(
      "Purchased",
    );
  });

  it("a wrapper with a custom prototype is not a mapped source", () => {
    const wrapper = Object.create({ marker: 1 }) as CellShellMappedValueSource;
    Reflect.set(wrapper, "map", { true: "LEAKED" });
    Reflect.set(wrapper, "fallback", "LEAKED-FB");
    expect(Object.prototype.hasOwnProperty.call(wrapper, "map")).toBe(true);
    // Own map, but the wrapper prototype is neither Object.prototype nor null.
    expect(resolveShellValue(wrapper, ctx({ value: true }))).toBe("Purchased");
  });

  it("an array wrapper is not a mapped source", () => {
    const wrapper: string[] = [];
    Reflect.set(wrapper, "map", { true: "LEAKED" });
    expect(resolveShellValue(sourceHolder(wrapper), ctx({ value: true }))).toBe(
      "Purchased",
    );
  });

  it("a null-prototype wrapper with an own map resolves normally", () => {
    const wrapper = Object.create(null) as CellShellMappedValueSource;
    Reflect.set(wrapper, "from", "value");
    Reflect.set(wrapper, "map", { true: CHECKED, false: UNCHECKED });
    Reflect.set(wrapper, "fallback", "FB");

    expect(resolveShellValue(wrapper, ctx({ value: true }))).toBe(CHECKED);
    expect(resolveShellValue(wrapper, ctx({ value: false }))).toBe(UNCHECKED);
    expect(resolveShellValue(wrapper, ctx({ value: "missing" }))).toBe("FB");
  });

  it("an ordinary frozen mapped source resolves normally", () => {
    const wrapper: CellShellMappedValueSource = Object.freeze({
      from: "value" as const,
      map: Object.freeze({ true: CHECKED, false: UNCHECKED }),
      fallback: "FB",
    });
    expect(Object.isFrozen(wrapper)).toBe(true);
    expect(resolveShellValue(wrapper, ctx({ value: true }))).toBe(CHECKED);
    expect(resolveShellValue(wrapper, ctx({ value: false }))).toBe(UNCHECKED);
    expect(resolveShellValue(wrapper, ctx({ value: "missing" }))).toBe("FB");
  });

  // Test 32
  it("from defaults to raw value when omitted", () => {
    const src: CellShellMappedValueSource = { map: { true: "T", false: "F" } };
    // formattedValue deliberately differs from the raw value.
    expect(resolveShellValue(src, ctx({ value: true, formattedValue: "Yes" }))).toBe(
      "T",
    );
    expect(resolveShellValue(src, ctx({ value: false, formattedValue: "No" }))).toBe(
      "F",
    );
  });

  // Test 33
  it("from: { field } reads the sibling field; an absent field takes the null path", () => {
    const src: CellShellMappedValueSource = {
      from: { field: "status" },
      map: { ok: "OK-ASSET" },
      fallback: "FB",
    };
    expect(
      resolveShellValue(src, ctx({ row: { status: "ok" }, value: null })),
    ).toBe("OK-ASSET");
    expect(resolveShellValue(src, ctx({ row: {}, value: null }))).toBe("FB");
  });

  // Test 34
  it("from: { literal } and from: formattedValue behave as expected", () => {
    expect(
      resolveShellValue(
        { from: { literal: "k" }, map: { k: "LIT" } },
        ctx({ value: null }),
      ),
    ).toBe("LIT");
    expect(
      resolveShellValue(
        { from: "formattedValue", map: { Purchased: "FMT" } },
        ctx({ value: false, formattedValue: "Purchased" }),
      ),
    ).toBe("FMT");
  });

  // Test 35 — resolver mutation isolation only (A-6 also requires Test 38 at
  // the real CellShellManager boundary; do not claim manager behavior here).
  it("never mutates the supplied config, map, or row", () => {
    const map = { true: CHECKED, false: UNCHECKED };
    const src: CellShellMappedValueSource = { from: "value", map, fallback: "FB" };
    const srcSnapshot = JSON.stringify(src);
    const mapSnapshot = JSON.stringify(map);
    const row = { bought: true };
    const rowSnapshot = JSON.stringify(row);

    resolveShellValue(src, ctx({ value: true, row }));
    resolveShellValue(src, ctx({ value: null, row }));
    resolveShellValue(src, ctx({ value: "missing", row }));

    expect(JSON.stringify(src)).toBe(srcSnapshot);
    expect(JSON.stringify(map)).toBe(mapSnapshot);
    expect(JSON.stringify(row)).toBe(rowSnapshot);
    expect(Object.keys(map)).toEqual(["true", "false"]);
  });

  // Test 35 (frozen-config variant of the resolver no-mutation rule only)
  it("works with a deeply frozen configuration", () => {
    const src = Object.freeze({
      from: "value" as const,
      map: Object.freeze({ true: CHECKED }),
      fallback: "FB",
    });
    expect(resolveShellValue(src, ctx({ value: true }))).toBe(CHECKED);
    expect(resolveShellValue(src, ctx({ value: false }))).toBe("FB");
  });

  // Test 37
  it("round-trips through JSON with identical behavior", () => {
    const src: CellShellMappedValueSource = {
      from: { field: "status" },
      map: { ok: "OK", bad: "BAD" },
      fallback: "FB",
    };
    const clone = JSON.parse(JSON.stringify(src)) as CellShellMappedValueSource;
    for (const status of ["ok", "bad", "other", undefined]) {
      const c = ctx({ row: status === undefined ? {} : { status }, value: null });
      expect(resolveShellValue(clone, c)).toBe(resolveShellValue(src, c));
    }
  });

  it("base sources still behave exactly as before", () => {
    expect(resolveShellValue(undefined, ctx())).toBe("Purchased");
    expect(resolveShellValue("formattedValue", ctx())).toBe("Purchased");
    expect(resolveShellValue("value", ctx({ value: true }))).toBe("true");
    expect(resolveShellValue("value", ctx({ value: null }))).toBe("");
    expect(resolveShellValue({ literal: "L" }, ctx())).toBe("L");
    expect(resolveShellValue({ field: "other" }, ctx())).toBe("x");
    expect(resolveShellValue({ field: "missing" }, ctx())).toBe("");
  });

  // Test 27 (whole-source extension): a whole source that is not a recognized
  // base or mapped shape fails closed to the formatted-value fallback. Injected
  // with Reflect.set so the cases stay assertion-free at the type boundary.
  it.each([
    ["null", null],
    ["a number", 42],
    ["a boolean", true],
    ["a function", () => "x"],
    ["an array", ["a", "b"]],
    ["an unrecognized plain object", { foo: 1 }],
  ])(
    "a whole source that is %s fails closed to formattedValue without throw, warning, or mutation",
    (_label, malformed) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const holder: { source: CellShellValueSource | undefined } = {
        source: "formattedValue",
      };
      try {
        Reflect.set(holder, "source", malformed);
        const before = holder.source;
        let result = "";
        expect(() => {
          result = resolveShellValue(
            holder.source,
            ctx({ formattedValue: "Purchased" }),
          );
        }).not.toThrow();
        expect(result).toBe("Purchased");
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
        // Resolution must not replace or rewrite the injected source.
        expect(holder.source).toBe(before);
        expect(holder.source).toBe(malformed);
        if (malformed !== null && typeof malformed === "object") {
          expect(JSON.stringify(malformed)).toBe(JSON.stringify(before));
        }
      } finally {
        warn.mockRestore();
        error.mockRestore();
      }
    },
  );

  it("an array with an own literal/field still fails closed to formattedValue", () => {
    const withLiteral: string[] = ["a"];
    Reflect.set(withLiteral, "literal", "LEAKED");
    expect(
      resolveShellValue(sourceHolder(withLiteral), ctx({ formattedValue: "Purchased" })),
    ).toBe("Purchased");

    const withField: string[] = ["a"];
    Reflect.set(withField, "field", "other");
    expect(
      resolveShellValue(sourceHolder(withField), ctx({ formattedValue: "Purchased" })),
    ).toBe("Purchased");
  });

  it("inherited literal/field on a non-plain wrapper does not resolve", () => {
    const donor = { literal: "LEAKED", field: "other" };
    const wrapper = Object.create(donor) as object;
    expect("literal" in wrapper).toBe(true);
    expect(
      resolveShellValue(
        sourceHolder(wrapper),
        ctx({ formattedValue: "Purchased" }),
      ),
    ).toBe("Purchased");
  });
});

describe("resolveShellTone default is unchanged (Test 39)", () => {
  it("defaults its base to formattedValue, not raw value", () => {
    // Raw value and formatted value deliberately disagree.
    const c = ctx({ value: true, formattedValue: "Active State" });
    // No `from`: tone must read formattedValue and slugify it.
    expect(resolveShellTone({}, c)).toBe("active-state");
    // A generic mapped source with no `from` would read the raw value instead.
    expect(resolveShellValue({ map: { true: "RAW" } }, c)).toBe("RAW");
  });

  it("map, fallback, and slug behavior are unchanged", () => {
    const c = ctx({ value: false, formattedValue: "Pending Review" });
    expect(resolveShellTone({ map: { "Pending Review": "warn" } }, c)).toBe("warn");
    expect(resolveShellTone({ map: { other: "x" }, fallback: "neutral" }, c)).toBe(
      "neutral",
    );
    expect(resolveShellTone({}, c)).toBe("pending-review");
    expect(resolveShellTone({ from: "value" }, c)).toBe("false");
    expect(
      resolveShellTone({ from: { field: "other" }, map: { x: "tone-x" } }, c),
    ).toBe("tone-x");
  });

  it("underscores and whitespace collapse to hyphens as before", () => {
    expect(
      resolveShellTone({}, ctx({ formattedValue: "In   Progress_Now" })),
    ).toBe("in-progress-now");
  });
});
