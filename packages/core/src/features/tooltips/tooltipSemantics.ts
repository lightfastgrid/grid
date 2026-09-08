import {
  addAriaDescribedByToken,
  removeAriaDescribedByToken,
} from "../../internal/ariaIdReferenceTokens";

export interface TooltipIdAllocator {
  allocate(): string;
}

const TOOLTIP_ID_PATTERN = /^lfg-tooltip-([1-9]\d*)$/;

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

export function createTooltipIdAllocator(initialNextId = 1): TooltipIdAllocator {
  assertPositiveSafeInteger(initialNextId, "initialNextId");
  let nextId = initialNextId;
  let exhausted = false;

  return {
    allocate(): string {
      if (exhausted) {
        throw new Error("Tooltip id allocator exhausted");
      }
      const id = `lfg-tooltip-${nextId}`;
      if (nextId === Number.MAX_SAFE_INTEGER) {
        exhausted = true;
      } else {
        nextId += 1;
      }
      return id;
    },
  };
}

const productionTooltipIdAllocator = createTooltipIdAllocator();

export function allocateTooltipId(): string {
  return productionTooltipIdAllocator.allocate();
}

function assertTooltipId(value: string): string {
  const match = TOOLTIP_ID_PATTERN.exec(value);
  if (
    match === null ||
    !Number.isSafeInteger(Number(match[1])) ||
    Number(match[1]) < 1
  ) {
    throw new Error("Invalid tooltip id");
  }
  return value;
}

export function applyTooltipElementSemantics(
  element: HTMLElement,
  tooltipId: string,
): void {
  const id = assertTooltipId(tooltipId);
  if (element.id !== id) element.id = id;
  if (element.getAttribute("role") !== "tooltip") {
    element.setAttribute("role", "tooltip");
  }
  if (element.hasAttribute("tabindex")) {
    element.removeAttribute("tabindex");
  }
}

export function connectTooltipTarget(
  target: HTMLElement,
  tooltipId: string,
): void {
  addAriaDescribedByToken(target, assertTooltipId(tooltipId));
}

export function disconnectTooltipTarget(
  target: HTMLElement,
  tooltipId: string,
): void {
  removeAriaDescribedByToken(target, assertTooltipId(tooltipId));
}
