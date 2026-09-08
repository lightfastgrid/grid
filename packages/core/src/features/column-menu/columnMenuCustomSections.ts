import type {
  ColumnMenuCustomItem,
  ColumnMenuCustomSection,
  ColumnMenuSectionActionContext,
} from "../../types";

import type { ColumnMenuItem, ColumnMenuSection } from "./types";

function bindCustomItemAction(
  item: ColumnMenuCustomItem,
  actionContext: ColumnMenuSectionActionContext,
): ColumnMenuItem {
  return {
    id: item.id,
    label: item.label,
    icon: item.icon,
    disabled: item.disabled,
    hidden: item.hidden,
    action: item.action
      ? () => item.action?.(actionContext)
      : undefined,
  };
}

function toInternalCustomSection(
  section: ColumnMenuCustomSection,
  actionContext: ColumnMenuSectionActionContext,
): ColumnMenuSection {
  return {
    id: section.id,
    items: section.items.map((item) => bindCustomItemAction(item, actionContext)),
  };
}

function insertBeforeOrAfter(
  sections: ColumnMenuSection[],
  section: ColumnMenuSection,
  beforeId?: string,
  afterId?: string,
): boolean {
  if (beforeId) {
    const idx = sections.findIndex((s) => s.id === beforeId);
    if (idx >= 0) {
      sections.splice(idx, 0, section);
      return true;
    }
  }
  if (afterId) {
    const idx = sections.findIndex((s) => s.id === afterId);
    if (idx >= 0) {
      sections.splice(idx + 1, 0, section);
      return true;
    }
  }
  return false;
}

export function mergeColumnMenuSections(
  defaultSections: ColumnMenuSection[],
  customSections: ColumnMenuCustomSection[] | undefined,
  actionContext: ColumnMenuSectionActionContext,
): ColumnMenuSection[] {
  if (!customSections || customSections.length === 0) {
    return defaultSections;
  }

  const working = [...defaultSections];
  const top: ColumnMenuSection[] = [];
  const bottom: ColumnMenuSection[] = [];

  for (const custom of customSections) {
    const section = toInternalCustomSection(custom, actionContext);
    const placedByAnchor = insertBeforeOrAfter(
      working,
      section,
      custom.before,
      custom.after,
    );
    if (placedByAnchor) continue;

    if (custom.position === "top") top.push(section);
    else bottom.push(section);
  }

  return [...top, ...working, ...bottom];
}
