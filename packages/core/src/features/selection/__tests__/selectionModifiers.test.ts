import { describe, expect, it } from "vitest";

import { selectionPointerModifiers } from "../../../internal/selectionModifiers";

type ModEvent = Parameters<typeof selectionPointerModifiers>[0];

describe("selectionPointerModifiers", () => {
  it("detects Ctrl/Meta additive and Shift range", () => {
    expect(
      selectionPointerModifiers({
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      } as ModEvent),
    ).toEqual({
      additive: false,
      range: false,
    });

    expect(
      selectionPointerModifiers({
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      } as ModEvent).additive,
    ).toBe(true);

    expect(
      selectionPointerModifiers({
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
      } as ModEvent).additive,
    ).toBe(true);

    expect(
      selectionPointerModifiers({
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
      } as ModEvent).range,
    ).toBe(true);
  });
});
