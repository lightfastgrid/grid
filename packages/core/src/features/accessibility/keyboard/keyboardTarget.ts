export type KeyboardTargetKind =
  | "none"
  | "groupHeader"
  | "leafHeader"
  | "floatingFilter"
  | "bodyCell";

/**
 * Retained scalar target state. All fields exist for every kind so navigation
 * can reuse records instead of allocating discriminated-union objects per key.
 */
export interface KeyboardTargetState {
  kind: KeyboardTargetKind;
  level: number;
  spanIndex: number;
  anchorColumnOrdinal: number;
  visualRowIndex: number;
  displayRowIndex: number;
  columnOrdinal: number;
}

export function createKeyboardTargetState(): KeyboardTargetState {
  return {
    kind: "none",
    level: -1,
    spanIndex: -1,
    anchorColumnOrdinal: -1,
    visualRowIndex: -1,
    displayRowIndex: -1,
    columnOrdinal: -1,
  };
}

export function clearKeyboardTarget(target: KeyboardTargetState): void {
  target.kind = "none";
  target.level = -1;
  target.spanIndex = -1;
  target.anchorColumnOrdinal = -1;
  target.visualRowIndex = -1;
  target.displayRowIndex = -1;
  target.columnOrdinal = -1;
}

export function copyKeyboardTarget(
  target: KeyboardTargetState,
  source: Readonly<KeyboardTargetState>,
): void {
  target.kind = source.kind;
  target.level = source.level;
  target.spanIndex = source.spanIndex;
  target.anchorColumnOrdinal = source.anchorColumnOrdinal;
  target.visualRowIndex = source.visualRowIndex;
  target.displayRowIndex = source.displayRowIndex;
  target.columnOrdinal = source.columnOrdinal;
}

export function setGroupHeaderTarget(
  target: KeyboardTargetState,
  level: number,
  spanIndex: number,
  anchorColumnOrdinal: number,
): void {
  target.kind = "groupHeader";
  target.level = level;
  target.spanIndex = spanIndex;
  target.anchorColumnOrdinal = anchorColumnOrdinal;
  target.visualRowIndex = -1;
  target.displayRowIndex = -1;
  target.columnOrdinal = -1;
}

export function setLeafHeaderTarget(
  target: KeyboardTargetState,
  columnOrdinal: number,
): void {
  target.kind = "leafHeader";
  target.level = -1;
  target.spanIndex = -1;
  target.anchorColumnOrdinal = -1;
  target.visualRowIndex = -1;
  target.displayRowIndex = -1;
  target.columnOrdinal = columnOrdinal;
}

export function setFloatingFilterTarget(
  target: KeyboardTargetState,
  columnOrdinal: number,
): void {
  target.kind = "floatingFilter";
  target.level = -1;
  target.spanIndex = -1;
  target.anchorColumnOrdinal = -1;
  target.visualRowIndex = -1;
  target.displayRowIndex = -1;
  target.columnOrdinal = columnOrdinal;
}

export function setBodyCellTarget(
  target: KeyboardTargetState,
  visualRowIndex: number,
  displayRowIndex: number,
  columnOrdinal: number,
): void {
  target.kind = "bodyCell";
  target.level = -1;
  target.spanIndex = -1;
  target.anchorColumnOrdinal = -1;
  target.visualRowIndex = visualRowIndex;
  target.displayRowIndex = displayRowIndex;
  target.columnOrdinal = columnOrdinal;
}

export function keyboardTargetsEqual(
  left: Readonly<KeyboardTargetState>,
  right: Readonly<KeyboardTargetState>,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "none":
      return true;
    case "groupHeader":
      return (
        left.level === right.level &&
        left.spanIndex === right.spanIndex &&
        left.anchorColumnOrdinal === right.anchorColumnOrdinal
      );
    case "leafHeader":
    case "floatingFilter":
      return left.columnOrdinal === right.columnOrdinal;
    case "bodyCell":
      return (
        left.visualRowIndex === right.visualRowIndex &&
        left.displayRowIndex === right.displayRowIndex &&
        left.columnOrdinal === right.columnOrdinal
      );
  }
}

export type KeyboardMoveDirection =
  | "left"
  | "right"
  | "up"
  | "down"
  | "home"
  | "end"
  | "pageUp"
  | "pageDown"
  | "firstTarget"
  | "lastTarget";

export type KeyboardWritingDirection = "ltr" | "rtl";

export type KeyboardNavigationIntent =
  | { readonly type: "none" }
  | { readonly type: "move"; readonly direction: KeyboardMoveDirection };

export const KEYBOARD_NAVIGATION_INTENT_NONE = Object.freeze({
  type: "none",
} as const satisfies KeyboardNavigationIntent);

export type KeyboardNavigationResult =
  | { readonly moved: false }
  | { readonly moved: true };

export const KEYBOARD_NAVIGATION_UNCHANGED = Object.freeze({
  moved: false,
} as const satisfies KeyboardNavigationResult);

export const KEYBOARD_NAVIGATION_MOVED = Object.freeze({
  moved: true,
} as const satisfies KeyboardNavigationResult);
