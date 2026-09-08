/**
 * Default pagination footer.
 *
 * Rendered inside the grid root (below the viewport) when client-side
 * pagination is enabled. Pure DOM — no framework — and fully restylable
 * through stable `lfg-pagination-*` class names; visual styling lives
 * in `themes/default.css`.
 *
 * UI page numbers are one-based; the internal page index stays
 * zero-based and is only converted at the label boundary.
 */

import type {
  GridPaginationSnapshot,
  PaginationChangeSource,
} from "../../types";

export interface PaginationFooterHandlers {
  setPageIndex(pageIndex: number, source: PaginationChangeSource): void;
  setPageSize(pageSize: number, source: PaginationChangeSource): void;
}

const ELLIPSIS = "…";

/** Number formatting for the summary text (e.g. `100,000`). */
function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * Compact one-based page list: all pages when few, otherwise first,
 * last, and a window around the current page with ellipsis gaps.
 * `current` is zero-based.
 */
export function buildPageItems(
  pageCount: number,
  current: number,
): (number | typeof ELLIPSIS)[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const include = new Set<number>([0, pageCount - 1]);
  for (let p = current - 1; p <= current + 1; p++) {
    if (p >= 0 && p < pageCount) include.add(p);
  }
  const items: (number | typeof ELLIPSIS)[] = [];
  let previous = -1;
  for (const page of [...include].sort((a, b) => a - b)) {
    if (previous !== -1 && page - previous > 1) items.push(ELLIPSIS);
    items.push(page + 1);
    previous = page;
  }
  return items;
}

export class PaginationFooter {
  readonly element: HTMLDivElement;
  private readonly summary: HTMLSpanElement;
  private readonly pages: HTMLDivElement;
  private readonly select: HTMLSelectElement;
  private lastSyncKey = "";
  private lastPagesKey = "";
  private lastOptionsKey = "";
  private lastSummaryText = "";
  private lastPageSize: number | null = null;

  constructor(private readonly handlers: PaginationFooterHandlers) {
    this.element = document.createElement("div");
    this.element.className = "lfg-pagination";

    this.summary = document.createElement("span");
    this.summary.className = "lfg-pagination-summary";
    this.element.appendChild(this.summary);

    this.pages = document.createElement("div");
    this.pages.className = "lfg-pagination-pages";
    this.element.appendChild(this.pages);

    const pageSizeWrap = document.createElement("label");
    pageSizeWrap.className = "lfg-pagination-page-size";
    const label = document.createElement("span");
    label.className = "lfg-pagination-page-size-label";
    label.textContent = "Rows per page";
    this.select = document.createElement("select");
    this.select.className = "lfg-pagination-page-size-select";
    this.select.addEventListener("change", () => {
      const size = Number(this.select.value);
      if (Number.isFinite(size) && size > 0) {
        this.handlers.setPageSize(size, "ui");
      }
    });
    pageSizeWrap.appendChild(label);
    pageSizeWrap.appendChild(this.select);
    this.element.appendChild(pageSizeWrap);
  }

  sync(state: GridPaginationSnapshot): void {
    const syncKey =
      `${state.pageIndex}|${state.pageSize}|${state.pageCount}|` +
      `${state.totalRows}|${state.pageSizeOptions.join(",")}`;
    if (syncKey === this.lastSyncKey) return;
    const summaryText =
      `Showing ${formatCount(state.startRow)} to ${formatCount(state.endRow)}` +
      ` of ${formatCount(state.totalRows)} rows`;

    const pagesKey = `${state.pageIndex}|${state.pageCount}`;
    if (pagesKey !== this.lastPagesKey) {
      this.syncPages(state);
      this.lastPagesKey = pagesKey;
    }
    this.syncPageSizeSelect(state);
    if (summaryText !== this.lastSummaryText) {
      this.summary.textContent = summaryText;
      this.lastSummaryText = summaryText;
    }
    this.lastSyncKey = syncKey;
  }

  private syncPages(state: GridPaginationSnapshot): void {
    const { pageIndex, pageCount } = state;
    const nextPages = this.element.ownerDocument.createDocumentFragment();

    nextPages.appendChild(
      this.createNavButton("‹", "Previous page", pageIndex <= 0, () => {
        this.handlers.setPageIndex(pageIndex - 1, "ui");
      }),
    );

    for (const item of buildPageItems(pageCount, pageIndex)) {
      if (item === ELLIPSIS) {
        const ellipsis = this.element.ownerDocument.createElement("span");
        ellipsis.className = "lfg-pagination-ellipsis";
        ellipsis.textContent = ELLIPSIS;
        ellipsis.setAttribute("aria-hidden", "true");
        nextPages.appendChild(ellipsis);
        continue;
      }
      const onePage = item;
      const button = this.createNavButton(
        String(onePage),
        `Page ${onePage}`,
        false,
        () => {
          this.handlers.setPageIndex(onePage - 1, "ui");
        },
      );
      if (onePage - 1 === pageIndex) {
        button.classList.add("lfg-pagination-button-active");
        button.setAttribute("aria-current", "page");
      }
      nextPages.appendChild(button);
    }

    nextPages.appendChild(
      this.createNavButton(
        "›",
        "Next page",
        pageCount === 0 || pageIndex >= pageCount - 1,
        () => {
          this.handlers.setPageIndex(pageIndex + 1, "ui");
        },
      ),
    );

    this.pages.replaceChildren(nextPages);
  }

  private createNavButton(
    text: string,
    ariaLabel: string,
    disabled: boolean,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = this.element.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "lfg-pagination-button";
    button.textContent = text;
    button.setAttribute("aria-label", ariaLabel);
    if (disabled) {
      button.classList.add("lfg-pagination-button-disabled");
      button.disabled = true;
    } else {
      button.addEventListener("click", onClick);
    }
    return button;
  }

  private syncPageSizeSelect(state: GridPaginationSnapshot): void {
    const optionsKey = state.pageSizeOptions.join(",");
    if (optionsKey !== this.lastOptionsKey) {
      const nextOptions = this.element.ownerDocument.createDocumentFragment();
      for (const size of state.pageSizeOptions) {
        const option = this.element.ownerDocument.createElement("option");
        option.value = String(size);
        option.textContent = String(size);
        nextOptions.appendChild(option);
      }
      this.select.replaceChildren(nextOptions);
      this.lastOptionsKey = optionsKey;
    }
    if (state.pageSize !== this.lastPageSize) {
      this.select.value = String(state.pageSize);
      this.lastPageSize = state.pageSize;
    }
  }

  destroy(): void {
    this.element.remove();
  }
}
