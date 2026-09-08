// Shared selectors for delegated cell-shell action handling.

/** A shell root carrying an action key, e.g. button/iconButton/link shells. */
export const CELL_SHELL_ACTION_SELECTOR = ".lfg-cell-shell[data-action]";

/** A child button inside a buttonGroup shell carrying an action key. */
export const CELL_SHELL_GROUP_ACTION_SELECTOR = ".lfg-cell-shell-group-button[data-action]";

/** Any child button inside a buttonGroup shell (with or without action key). */
export const CELL_SHELL_GROUP_BUTTON_SELECTOR = ".lfg-cell-shell-group-button";

/** A shell root carrying an overlay key, e.g. button/iconButton/link shells. */
export const CELL_SHELL_OVERLAY_SELECTOR = ".lfg-cell-shell[data-overlay-key]";

/** Exact delegated activation target for a boolean presentation checkbox. */
export const CELL_SHELL_CHECKBOX_INPUT_SELECTOR =
  "input.lfg-cell-shell-checkbox-input";

const CELL_SHELL_CHECKBOX_SELECTOR = ".lfg-cell-shell-checkbox";

/**
 * Whether a clicked element lives inside a cell-shell action element or a
 * buttonGroup child button. Used by the selection controller to skip
 * row-click selection for interactive shell elements.
 */
export function isCellShellActionTarget(el: Element): boolean {
  return !!(
    el.closest(CELL_SHELL_ACTION_SELECTOR) ||
    el.closest(CELL_SHELL_GROUP_BUTTON_SELECTOR) ||
    el.closest(CELL_SHELL_CHECKBOX_SELECTOR)
  );
}

/**
 * Whether a clicked element lives inside a cell-shell overlay trigger. Used by
 * the selection controller to skip row-click selection for overlay triggers.
 */
export function isCellShellOverlayTarget(el: Element): boolean {
  return !!el.closest(CELL_SHELL_OVERLAY_SELECTOR);
}
