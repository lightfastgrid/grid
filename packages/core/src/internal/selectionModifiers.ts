export interface SelectionPointerModifiers {
  additive: boolean;
  range: boolean;
}

export function selectionPointerModifiers(
  event: MouseEvent,
): SelectionPointerModifiers {
  return {
    additive: event.ctrlKey || event.metaKey,
    range: event.shiftKey,
  };
}
