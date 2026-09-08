import type { GridRootSnapshot } from "../gridRootStructuralSnapshot";

// `aria-activedescendant` is managed by the body-cell reconciler because it
// targets stable physical cell IDs. It is intentionally outside this semantic
// surface catalog so surface-only updates cannot clear current composite focus.
const GRID_ROOT_ATTRS = [
  "role",
  "aria-rowcount",
  "aria-colcount",
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "aria-multiselectable",
  "aria-busy",
] as const;

function setOrRemoveAttribute(
  root: HTMLElement,
  name: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    root.removeAttribute(name);
    return;
  }
  root.setAttribute(name, value);
}

function setBooleanAttribute(
  root: HTMLElement,
  name: string,
  value: boolean,
): void {
  if (value) {
    root.setAttribute(name, "true");
    return;
  }
  root.removeAttribute(name);
}

/** Writes-only application of grid-surface attributes (ACCESSIBILITY_V2_SURFACE §1). */
export function applyGridRootAttributes(
  root: HTMLElement,
  snapshot: GridRootSnapshot,
): void {
  root.setAttribute("role", snapshot.role);
  root.setAttribute("aria-rowcount", String(snapshot.ariaRowCount));
  root.setAttribute("aria-colcount", String(snapshot.ariaColCount));
  setOrRemoveAttribute(root, "aria-label", snapshot.ariaLabel);
  setOrRemoveAttribute(root, "aria-labelledby", snapshot.ariaLabelledBy);
  setOrRemoveAttribute(root, "aria-describedby", snapshot.ariaDescribedBy);
  setBooleanAttribute(root, "aria-multiselectable", snapshot.ariaMultiselectable);
  setBooleanAttribute(root, "aria-busy", snapshot.ariaBusy);
}

/** Remove surface attributes applied by the accessibility plugin on detach. */
export function clearGridRootAttributes(root: HTMLElement): void {
  for (const name of GRID_ROOT_ATTRS) {
    root.removeAttribute(name);
  }
}
