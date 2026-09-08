import type {
  KeyboardNavigationIntent,
} from "./keyboardTarget";
import {
  KEYBOARD_NAVIGATION_INTENT_NONE,
} from "./keyboardTarget";

const INTENT_LEFT = Object.freeze({ type: "move", direction: "left" } as const);
const INTENT_RIGHT = Object.freeze({ type: "move", direction: "right" } as const);
const INTENT_UP = Object.freeze({ type: "move", direction: "up" } as const);
const INTENT_DOWN = Object.freeze({ type: "move", direction: "down" } as const);
const INTENT_HOME = Object.freeze({ type: "move", direction: "home" } as const);
const INTENT_END = Object.freeze({ type: "move", direction: "end" } as const);
const INTENT_PAGE_UP = Object.freeze({ type: "move", direction: "pageUp" } as const);
const INTENT_PAGE_DOWN = Object.freeze({ type: "move", direction: "pageDown" } as const);
const INTENT_FIRST = Object.freeze({ type: "move", direction: "firstTarget" } as const);
const INTENT_LAST = Object.freeze({ type: "move", direction: "lastTarget" } as const);

/** Resolve scalar key data without constructing an input object. */
export function resolveKeyboardNavigationIntent(
  key: string,
  ctrlOrMeta: boolean,
): KeyboardNavigationIntent {
  switch (key) {
    case "ArrowLeft": return INTENT_LEFT;
    case "ArrowRight": return INTENT_RIGHT;
    case "ArrowUp": return INTENT_UP;
    case "ArrowDown": return INTENT_DOWN;
    case "Home": return ctrlOrMeta ? INTENT_FIRST : INTENT_HOME;
    case "End": return ctrlOrMeta ? INTENT_LAST : INTENT_END;
    case "PageUp": return INTENT_PAGE_UP;
    case "PageDown": return INTENT_PAGE_DOWN;
    default: return KEYBOARD_NAVIGATION_INTENT_NONE;
  }
}
