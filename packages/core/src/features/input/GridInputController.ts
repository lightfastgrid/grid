/** Pointer focus ownership for the neutral grid surface. */

/**
 * Inline cell-editor host wrapper (see `HOST_CLASS` in editing/editingDom.ts).
 * Any pointerdown inside it is an editor hit: do not steal focus to the grid
 * surface. Must match the real host
 * class — matching only `.lfg-cell-editor` here silently excluded checkbox,
 * select, and date editors (whose input `type` is not in the text allowlist
 * below), so clicking them let focus escape to the surface and blur-committed
 * the editor before the interaction landed.
 */
const CELL_EDITOR_ROOT_SELECTOR = ".lfg-cell-editor-host";

const POINTER_SKIP_FOCUS_TYPES = new Set([
  "text",
  "search",
  "number",
  "email",
  "password",
  "tel",
  "url",
]);

const POINTER_FOCUS_OWNER_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[tabindex]",
].join(", ");

const COMPOSITE_TARGET_SELECTOR = [
  ".lfg-grid-surface",
  ".lfg-cell",
  ".lfg-header-cell",
  ".lfg-floating-filter-cell",
  ".lfg-group-header-span",
].join(", ");

/**
 * Pointer-owned surface focus. `focusVisible: false` keeps mouse clicks from
 * matching `:focus-visible` after preventDefault cancels native focus.
 * TypeScript's shipped DOM lib does not yet declare the option.
 */
const POINTER_SURFACE_FOCUS = Object.freeze({
  preventScroll: true,
  focusVisible: false,
}) as FocusOptions;

function isGridSelectionCheckboxEl(el: Element): boolean {
  return (
    el.matches(".lfg-row-selection-checkbox, .lfg-header-selection-checkbox") ||
    el.closest(".lfg-row-selection-checkbox, .lfg-header-selection-checkbox") !==
      null
  );
}

/** True when `pointerdown` should not move focus to the grid root. */
function shouldSkipMovingFocusToGridRoot(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(CELL_EDITOR_ROOT_SELECTOR)) return true;
  if (target.closest("textarea")) return true;
  if (target.closest("select")) return true;
  if (target.closest("[contenteditable='true']")) return true;

  const input = target.closest("input");
  if (!input) return false;
  if (isGridSelectionCheckboxEl(input)) return false;

  const type = input.type.toLowerCase() || "text";
  return POINTER_SKIP_FOCUS_TYPES.has(type);
}

/**
 * Normal composite targets carry `tabindex="-1"` for active-descendant
 * semantics. Cancel their native pointer focus so the browser cannot move DOM
 * focus away from the surface after this controller focuses it. Real controls
 * keep their native pointer-focus default and enter Widget/Edit ownership.
 */
function shouldCancelNativePointerFocus(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  const focusOwner = target.closest(POINTER_FOCUS_OWNER_SELECTOR);
  return focusOwner === null || focusOwner.matches(COMPOSITE_TARGET_SELECTOR);
}

export class GridInputController {
  private root: HTMLElement | null = null;
  /** Focus target for pointer interaction — the neutral grid surface. */
  private focusTarget: HTMLElement | null = null;

  /**
   * Listeners are delegated on the outer `root` (event bubbling preserves
   * behavior). Pointer interaction focuses `focusTarget` — the grid surface —
   * which owns the base tabindex and composite grid role.
   */
  attach(root: HTMLElement, focusTarget: HTMLElement = root): void {
    this.detach();
    this.root = root;
    this.focusTarget = focusTarget;
    this.root.addEventListener("pointerdown", this.onPointerDown);
  }

  detach(): void {
    if (this.root) {
      this.root.removeEventListener("pointerdown", this.onPointerDown);
      this.root = null;
      this.focusTarget = null;
    }
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.root || !this.focusTarget) return;
    if (event.button !== 0) return;
    if (shouldSkipMovingFocusToGridRoot(event.target)) return;
    if (shouldCancelNativePointerFocus(event.target)) event.preventDefault();
    // Pointer focus must not match :focus-visible. preventDefault + focus()
    // otherwise looks like keyboard focus and paints header/filter rings.
    this.focusTarget.focus(POINTER_SURFACE_FOCUS);
  };

}
