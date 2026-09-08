export const HEADER_ACTION_TRIGGER_CLASS = "lfg-header-action-trigger";
export const HEADER_ACTIONS_CLASS = "lfg-header-actions";

export function isHeaderActionUiTarget(el: Element): boolean {
  return !!el.closest(`.${HEADER_ACTION_TRIGGER_CLASS}`);
}
