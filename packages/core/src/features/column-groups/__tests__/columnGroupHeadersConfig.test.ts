import { describe, expect, it } from "vitest";

import { isColumnGroupHeadersEnabled } from "../columnGroupHeadersConfig";

describe("isColumnGroupHeadersEnabled", () => {
  it("defaults to enabled", () => {
    expect(isColumnGroupHeadersEnabled(undefined)).toBe(true);
    expect(isColumnGroupHeadersEnabled(true)).toBe(true);
    expect(isColumnGroupHeadersEnabled({ enabled: true })).toBe(true);
    expect(isColumnGroupHeadersEnabled({})).toBe(true);
  });

  it("disables for false and { enabled: false }", () => {
    expect(isColumnGroupHeadersEnabled(false)).toBe(false);
    expect(isColumnGroupHeadersEnabled({ enabled: false })).toBe(false);
  });
});
