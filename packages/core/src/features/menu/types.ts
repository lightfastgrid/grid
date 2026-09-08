import type { PopupRole } from "./popupSemantics";

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  className?: string;
  disabled?: boolean;
  hidden?: boolean;
  action?: () => void;
}

export interface MenuSection {
  id: string;
  items: MenuItem[];
  render?: (host: HTMLElement) => void | (() => void);
}

export interface MenuPanelConfig {
  /** CSS class applied to the panel root element. */
  panelClass: string;
  /** CSS class applied to each menu item button. */
  itemClass: string;
  /** CSS class applied to each icon span. */
  iconClass: string;
  /** CSS class applied to each label span. */
  labelClass?: string;
  /** CSS class applied to each section separator. */
  separatorClass: string;
  /** Owner-local Escape/Tab dismissal request. */
  onRequestClose?: (reason: "escape" | "tab") => void;
}

export interface MenuPanelResult {
  element: HTMLElement;
  cleanup: () => void;
  /** Focus the first enabled menu item or rendered native control. */
  focusFirst: () => boolean;
}

export interface MenuPanelSemantics {
  id: string;
  ariaLabel: string;
  role: PopupRole;
}
