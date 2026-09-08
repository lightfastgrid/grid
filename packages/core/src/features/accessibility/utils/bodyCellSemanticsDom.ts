import { replaceOwnedAriaDescribedByTokens } from "../../../internal/ariaIdReferenceTokens";

const BODY_CELL_BINDING_ATTRIBUTES = [
  "role",
  "aria-colindex",
  "aria-label",
  "aria-selected",
] as const;

const BODY_CELL_PHYSICAL_ATTRIBUTES = ["id", "tabindex"] as const;

export interface BodyCellElementSemantics {
  readonly id: string;
  readonly ariaColIndex: number;
  readonly ariaLabel: string | undefined;
  readonly ariaSelected: boolean | undefined;
  readonly previousAriaDescribedBy: string | undefined;
  readonly ariaDescribedBy: string | undefined;
}

function setOrRemoveAttribute(
  element: HTMLElement,
  name: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    if (element.hasAttribute(name)) {
      element.removeAttribute(name);
    }
    return;
  }
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

export function applyPhysicalBodyCellSemantics(
  element: HTMLElement,
  id: string,
): void {
  setOrRemoveAttribute(element, "id", id);
  setOrRemoveAttribute(element, "tabindex", "-1");
}

export function applyBodyCellElementSemantics(
  element: HTMLElement,
  semantics: BodyCellElementSemantics,
): void {
  applyPhysicalBodyCellSemantics(element, semantics.id);
  setOrRemoveAttribute(element, "role", "gridcell");
  setOrRemoveAttribute(
    element,
    "aria-colindex",
    String(semantics.ariaColIndex),
  );
  setOrRemoveAttribute(element, "aria-label", semantics.ariaLabel);
  setOrRemoveAttribute(
    element,
    "aria-selected",
    semantics.ariaSelected === undefined
      ? undefined
      : semantics.ariaSelected
        ? "true"
        : "false",
  );
  replaceOwnedAriaDescribedByTokens(
    element,
    semantics.previousAriaDescribedBy,
    semantics.ariaDescribedBy,
  );
}

export function clearBodyCellBindingSemantics(
  element: HTMLElement,
  ownedAriaDescribedBy: string | undefined,
): void {
  for (const attribute of BODY_CELL_BINDING_ATTRIBUTES) {
    if (element.hasAttribute(attribute)) {
      element.removeAttribute(attribute);
    }
  }
  replaceOwnedAriaDescribedByTokens(
    element,
    ownedAriaDescribedBy,
    undefined,
  );
}

export function clearBodyCellElementSemantics(
  element: HTMLElement,
  ownedAriaDescribedBy: string | undefined,
): void {
  clearBodyCellBindingSemantics(element, ownedAriaDescribedBy);
  for (const attribute of BODY_CELL_PHYSICAL_ATTRIBUTES) {
    if (element.hasAttribute(attribute)) {
      element.removeAttribute(attribute);
    }
  }
}
