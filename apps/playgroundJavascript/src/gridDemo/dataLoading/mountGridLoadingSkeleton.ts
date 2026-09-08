import "./loadingSkeleton.css";

const SKELETON_ROWS = 20;
const SKELETON_COLUMNS = 9;

const HEADER_GROUPS = [
  { span: 3 },
  { span: 2 },
  { span: 3 },
  { span: 1 },
] as const;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function skeletonBar(wide = false): HTMLSpanElement {
  return el(
    "span",
    `grid-loading-skeleton-bar${wide ? " grid-loading-skeleton-bar-wide" : ""}`,
  );
}

/**
 * Full-grid loading skeleton for gridDemo.
 * Vanilla port of React GridLoadingSkeleton — theme tokens handle light/dark.
 */
export function mountGridLoadingSkeleton(host: HTMLElement): () => void {
  const root = el("div", "grid-loading-skeleton");
  const table = el("div", "grid-loading-skeleton-table");

  const groupRow = el(
    "div",
    "grid-loading-skeleton-row grid-loading-skeleton-group-row",
  );
  for (const group of HEADER_GROUPS) {
    const cell = el("div", "grid-loading-skeleton-group");
    cell.style.flex = String(group.span);
    cell.append(skeletonBar(true));
    groupRow.append(cell);
  }
  table.append(groupRow);

  const headerRow = el(
    "div",
    "grid-loading-skeleton-row grid-loading-skeleton-header-row",
  );
  for (let index = 0; index < SKELETON_COLUMNS; index += 1) {
    const cell = el("div", "grid-loading-skeleton-cell");
    cell.append(skeletonBar());
    headerRow.append(cell);
  }
  table.append(headerRow);

  for (let rowIndex = 0; rowIndex < SKELETON_ROWS; rowIndex += 1) {
    const bodyRow = el(
      "div",
      "grid-loading-skeleton-row grid-loading-skeleton-body-row",
    );
    for (let colIndex = 0; colIndex < SKELETON_COLUMNS; colIndex += 1) {
      const cell = el("div", "grid-loading-skeleton-cell");
      cell.append(skeletonBar(colIndex === 0));
      bodyRow.append(cell);
    }
    table.append(bodyRow);
  }

  const footer = el("div", "grid-loading-skeleton-footer");
  footer.append(skeletonBar(true));
  const pages = el("div", "grid-loading-skeleton-footer-pages");
  for (let index = 0; index < 4; index += 1) {
    pages.append(el("span", "grid-loading-skeleton-page"));
  }
  footer.append(pages, skeletonBar());

  root.append(table, footer);
  host.append(root);

  return () => {
    root.remove();
  };
}
