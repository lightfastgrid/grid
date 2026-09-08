import { describe, expect, it } from "vitest";

import { resolveKeyboardNavigationIntent } from "../navigationIntent";

describe("Accessibility V2 keyboard intent", () => {
  it("137: returns frozen module constants from scalar arguments", () => {
    const left = resolveKeyboardNavigationIntent("ArrowLeft", false);
    expect(left).toEqual({ type: "move", direction: "left" });
    expect(Object.isFrozen(left)).toBe(true);
    expect(resolveKeyboardNavigationIntent("ArrowLeft", false)).toBe(left);

    const first = resolveKeyboardNavigationIntent("Home", true);
    expect(first).toEqual({ type: "move", direction: "firstTarget" });
    expect(resolveKeyboardNavigationIntent("Home", true)).toBe(first);

    const none = resolveKeyboardNavigationIntent("a", false);
    expect(none).toEqual({ type: "none" });
    expect(Object.isFrozen(none)).toBe(true);
    expect(resolveKeyboardNavigationIntent("a", false)).toBe(none);
  });
});
