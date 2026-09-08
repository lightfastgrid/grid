import type { GridBenchmarkVisibleState } from "./benchmarkProtocol.ts";

type VisibleStateOptions = {
  readonly host: HTMLElement | null;
  readonly viewportSelector: string;
  readonly rowSelector: string;
  readonly rowIdAttribute: string;
  readonly displayedRowCount: number;
  readonly columnCount: number;
};

function rankRenderedRowIds(
  host: HTMLElement,
  rowSelector: string,
  rowIdAttribute: string,
): string[] {
  return [...host.querySelectorAll<HTMLElement>(rowSelector)]
    .map((row) => ({
      id: row.getAttribute(rowIdAttribute),
      top: row.getBoundingClientRect().top,
    }))
    .filter((row): row is { id: string; top: number } => Boolean(row.id))
    .sort((left, right) => left.top - right.top)
    .map((row) => row.id);
}

export function readVisibleStateFromDom(
  options: VisibleStateOptions,
): GridBenchmarkVisibleState {
  const host = options.host;
  const viewport = host?.querySelector<HTMLElement>(options.viewportSelector);
  const ids = host ? rankRenderedRowIds(host, options.rowSelector, options.rowIdAttribute) : [];
  return {
    displayedRowCount: options.displayedRowCount,
    renderedRowCount: ids.length,
    firstRenderedRowId: ids[0] ?? null,
    lastRenderedRowId: ids[ids.length - 1] ?? null,
    scrollTop: viewport?.scrollTop ?? 0,
    scrollLeft: viewport?.scrollLeft ?? 0,
    columnCount: options.columnCount,
  };
}

export function countDomNodes(host: HTMLElement | null): number {
  if (!host) return 0;
  return host.querySelectorAll("*").length + 1;
}

export function scrollElement(
  host: HTMLElement | null,
  viewportSelector: string,
  top: number,
  left: number,
): void {
  const viewport = host?.querySelector<HTMLElement>(viewportSelector);
  if (!viewport) {
    throw new Error(`Viewport not found: ${viewportSelector}`);
  }
  viewport.scrollTop = top;
  viewport.scrollLeft = left;
}
