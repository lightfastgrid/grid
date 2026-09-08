// @vitest-environment jsdom

/**
 * Phase 4: group-header mutation + horizontal-virtualization regressions.
 * Mounted Grid only — no parallel mutation helpers.
 */

import { describe, expect, it, vi } from 'vitest';

import { Grid } from '../../../Grid';
import { CSS } from '../../../rendering/const/css-classes';
import type { DomGridRenderer } from '../../../rendering/DomGridRenderer';
import type {
  LightFastGridColumnInput,
  LightFastGridProps,
  RowData,
} from '../../../types';
import { DRAG_START_THRESHOLD_PX } from '../../column-order/ColumnOrderController';
import {
  GROUP_HEADER_ROW_CLASS,
  GROUP_HEADER_SPAN_CLASS,
} from '../columnGroupHeaderTypes';

async function flushRenders(): Promise<void> {
  // Accessibility header bindings settle after scrollend + two quiet frames.
  for (const viewport of document.querySelectorAll(`.${CSS.VIEWPORT}`)) {
    viewport.dispatchEvent(new Event('scrollend'));
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function getRenderer(grid: Grid): DomGridRenderer {
  return (grid as unknown as { renderer: DomGridRenderer }).renderer;
}

function scrollViewport(root: HTMLElement, scrollLeft: number): void {
  const viewport = root.querySelector<HTMLElement>(`.${CSS.VIEWPORT}`)!;
  viewport.scrollLeft = scrollLeft;
  viewport.dispatchEvent(new Event('scroll'));
}

function visibleGroupSpans(container: ParentNode): HTMLDivElement[] {
  return Array.from(
    container.querySelectorAll<HTMLDivElement>(`.${GROUP_HEADER_SPAN_CLASS}`),
  ).filter((el) => el.style.display !== 'none');
}

function spanSnapshot(container: ParentNode): Array<{
  text: string;
  left: string;
  width: string;
}> {
  return visibleGroupSpans(container).map((el) => ({
    text: el.textContent!.trim(),
    left: el.style.left,
    width: el.style.width,
  }));
}

function headerFields(root: HTMLElement): string[] {
  return Array.from(
    root.querySelectorAll(`.${CSS.HEADER_CELL}[data-col-id]`),
  ).map((el) => el.getAttribute('data-col-id') ?? '');
}

function mockHeaderRects(root: HTMLElement, width = 100): void {
  const cells = Array.from(
    root.querySelectorAll<HTMLElement>(`.${CSS.HEADER_CELL}[data-col-id]`),
  );
  let x = 0;
  for (const el of cells) {
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: x,
      width,
      top: 0,
      right: x + width,
      bottom: 40,
      height: 40,
      x,
      y: 0,
      toJSON: () => '',
    } as DOMRect);
    x += width;
  }
}

function getDragHandle(root: HTMLElement, field: string): HTMLElement {
  const handle = root.querySelector<HTMLElement>(
    `.lfg-column-drag-handle[data-col-id="${field}"]`,
  );
  if (!handle) throw new Error(`No drag handle for "${field}"`);
  return handle;
}

function nudgeClientX(clientX: number): number {
  return clientX + DRAG_START_THRESHOLD_PX + 1;
}

/** Drag `field` so its drop lands near `dropClientX` (header-local coords). */
async function dragColumn(
  root: HTMLElement,
  field: string,
  startClientX: number,
  dropClientX: number,
): Promise<void> {
  mockHeaderRects(root);
  getDragHandle(root, field).dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      clientX: startClientX,
      clientY: 0,
    }),
  );
  document.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 1,
      clientX: nudgeClientX(startClientX),
      clientY: 0,
    }),
  );
  document.dispatchEvent(
    new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: 1,
      clientX: dropClientX,
      clientY: 0,
    }),
  );
  await flushRenders();
}

function flattenFields(columns: LightFastGridColumnInput[]): string[] {
  const out: string[] = [];
  for (const c of columns) {
    if ('children' in c && Array.isArray(c.children)) {
      out.push(...flattenFields(c.children));
    } else if ('field' in c && typeof c.field === 'string') {
      out.push(c.field);
    }
  }
  return out;
}

async function createGrid(
  columns: LightFastGridColumnInput[],
  props: Partial<LightFastGridProps> = {},
  size: { height: string; width: string } = { height: '400px', width: '800px' },
) {
  const container = document.createElement('div');
  Object.assign(container.style, size);
  document.body.appendChild(container);

  const fields = flattenFields(columns);
  const row: RowData = { id: '1' };
  for (const f of fields) row[f] = f;

  const grid = new Grid({
    columns,
    rows: [row],
    getRowId: (r: RowData) => String(r.id),
    suppressRowVirtualization: true,
    suppressColumnVirtualization: true,
    ...props,
  });
  grid.mount(container);
  await flushRenders();
  const root = container.querySelector<HTMLElement>(`.${CSS.GRID}`)!;
  return { grid, container, root };
}

const TWO_GROUPS: LightFastGridColumnInput[] = [
  {
    headerName: 'Profile',
    groupId: 'profile',
    children: [
      { field: 'name', headerName: 'Name', width: 100 },
      { field: 'email', headerName: 'Email', width: 100 },
    ],
  },
  {
    headerName: 'Finance',
    groupId: 'finance',
    children: [
      { field: 'bank', headerName: 'Bank', width: 100 },
      { field: 'rating', headerName: 'Rating', width: 100 },
    ],
  },
];

describe('groupHeadersMutations', () => {
  // ── 1. Reorder split and merge ─────────────────────────────────────

  it('reorder splits a contiguous group and merges it back with no stale spans', async () => {
    const { grid, container, root } = await createGrid(TWO_GROUPS, {
      columnOrder: true,
    });

    const header = root.querySelector(`.${CSS.HEADER}`)!;
    expect(headerFields(root)).toEqual(['name', 'email', 'bank', 'rating']);
    expect(spanSnapshot(header)).toEqual([
      { text: 'Profile', left: '0px', width: '200px' },
      { text: 'Finance', left: '200px', width: '200px' },
    ]);

    // Move `email` after `rating` → order name, bank, rating, email.
    // Profile splits around contiguous Finance; no stale spans.
    // Rects: name 0-100, email 100-200, bank 200-300, rating 300-400.
    await dragColumn(root, 'email', 150, 400);

    expect(headerFields(root)).toEqual(['name', 'bank', 'rating', 'email']);
    const afterSplit = spanSnapshot(header);
    expect(afterSplit.filter((s) => s.text === 'Profile')).toEqual([
      { text: 'Profile', left: '0px', width: '100px' },
      { text: 'Profile', left: '300px', width: '100px' },
    ]);
    expect(afterSplit.filter((s) => s.text === 'Finance')).toEqual([
      { text: 'Finance', left: '100px', width: '200px' },
    ]);

    // Restore contiguous Profile by moving email back next to name.
    await dragColumn(root, 'email', 350, 100);

    expect(headerFields(root)).toEqual(['name', 'email', 'bank', 'rating']);
    const afterMerge = spanSnapshot(header);
    expect(afterMerge.filter((s) => s.text === 'Profile')).toHaveLength(1);
    expect(afterMerge.filter((s) => s.text === 'Finance')).toHaveLength(1);
    expect(afterMerge).toEqual([
      { text: 'Profile', left: '0px', width: '200px' },
      { text: 'Finance', left: '200px', width: '200px' },
    ]);
    expect(visibleGroupSpans(header)).toHaveLength(2);

    grid.destroy();
    container.remove();
  });

  // ── 2. Visibility ──────────────────────────────────────────────────

  it('hide/show grouped leaves updates spans, clears group height when flat, and restores without duplicates', async () => {
    const columns: LightFastGridColumnInput[] = [
      ...TWO_GROUPS,
      { field: 'notes', headerName: 'Notes', width: 100 },
    ];
    const { grid, container, root } = await createGrid(columns);
    const header = root.querySelector(`.${CSS.HEADER}`)!;
    const base = root.style.getPropertyValue('--lfg-base-header-height');

    expect(spanSnapshot(header).map((s) => s.text)).toEqual(
      expect.arrayContaining(['Profile', 'Finance']),
    );
    expect(root.style.getPropertyValue('--lfg-header-height')).not.toBe(base);

    grid.hideColumns(['email']);
    await flushRenders();
    expect(spanSnapshot(header)).toEqual(
      expect.arrayContaining([
        { text: 'Profile', left: '0px', width: '100px' },
        { text: 'Finance', left: '100px', width: '200px' },
      ]),
    );

    grid.hideColumns(['name', 'bank', 'rating']);
    await flushRenders();
    expect(root.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)).toBeNull();
    expect(root.style.getPropertyValue('--lfg-header-height')).toBe(base);
    expect(
      root.querySelector(`.${CSS.HEADER_CELL}[data-col-id="notes"]`),
    ).toBeTruthy();

    grid.showColumns(['name', 'email', 'bank', 'rating']);
    await flushRenders();
    expect(root.querySelectorAll(`.${GROUP_HEADER_ROW_CLASS}`)).toHaveLength(1);
    const restored = spanSnapshot(header);
    expect(restored.filter((s) => s.text === 'Profile')).toHaveLength(1);
    expect(restored.filter((s) => s.text === 'Finance')).toHaveLength(1);
    expect(restored).toEqual(
      expect.arrayContaining([
        { text: 'Profile', left: '0px', width: '200px' },
        { text: 'Finance', left: '200px', width: '200px' },
      ]),
    );

    grid.destroy();
    container.remove();
  });

  // ── 3. Pin / unpin ──────────────────────────────────────────────────

  it('pin/unpin splits group into lane-local spans and merges back without stale pinned rows', async () => {
    const columns: LightFastGridColumnInput[] = [
      {
        headerName: 'Shared',
        groupId: 'shared',
        children: [
          { field: 'a', headerName: 'A', width: 100 },
          { field: 'b', headerName: 'B', width: 100 },
          { field: 'c', headerName: 'C', width: 100 },
        ],
      },
    ];
    const { grid, container, root } = await createGrid(columns, {
      floatingFilters: true,
      defaultColDef: { filterable: true },
    });

    const header = root.querySelector(`.${CSS.HEADER}`)!;
    expect(spanSnapshot(header)).toEqual([
      { text: 'Shared', left: '0px', width: '300px' },
    ]);

    grid.pinColumn('a', 'left');
    await flushRenders();
    grid.pinColumn('c', 'right');
    await flushRenders();

    expect(root.querySelectorAll(`.${CSS.PINNED_LEFT_HEADER_STACK}`)).toHaveLength(1);
    expect(root.querySelectorAll(`.${CSS.PINNED_RIGHT_HEADER_STACK}`)).toHaveLength(1);

    const leftStack = root.querySelector(`.${CSS.PINNED_LEFT_HEADER_STACK}`)!;
    const rightStack = root.querySelector(`.${CSS.PINNED_RIGHT_HEADER_STACK}`)!;

    expect(spanSnapshot(leftStack)).toEqual([
      { text: 'Shared', left: '0px', width: '100px' },
    ]);
    // Center container is global X: lane-local 0 + left-pinned width (100).
    expect(spanSnapshot(header)).toEqual([
      { text: 'Shared', left: '100px', width: '100px' },
    ]);
    expect(spanSnapshot(rightStack)).toEqual([
      { text: 'Shared', left: '0px', width: '100px' },
    ]);

    for (const lane of [header, leftStack, rightStack]) {
      const children = Array.from(lane.children);
      const groupIdx = children.findIndex((el) =>
        el.classList.contains(GROUP_HEADER_ROW_CLASS),
      );
      const leafIdx = children.findIndex(
        (el) =>
          el.classList.contains(CSS.HEADER_ROW) ||
          el.classList.contains('lfg-pinned-header-row') ||
          el.classList.contains('lfg-pinned-right-header-row'),
      );
      const filterIdx = children.findIndex((el) =>
        el.classList.contains('lfg-floating-filter-row'),
      );
      expect(groupIdx).toBeGreaterThanOrEqual(0);
      expect(leafIdx).toBeGreaterThan(groupIdx);
      expect(filterIdx).toBe(leafIdx + 1);
    }

    grid.unpinColumn('a');
    grid.unpinColumn('c');
    await flushRenders();

    expect(root.querySelector(`.${CSS.PINNED_LEFT_HEADER_STACK}`)).toBeNull();
    expect(root.querySelector(`.${CSS.PINNED_RIGHT_HEADER_STACK}`)).toBeNull();
    expect(spanSnapshot(header)).toEqual([
      { text: 'Shared', left: '0px', width: '300px' },
    ]);
    expect(header.querySelectorAll(`.${GROUP_HEADER_ROW_CLASS}`)).toHaveLength(1);

    grid.destroy();
    container.remove();
  });

  // ── 4. Resize ──────────────────────────────────────────────────────

  it('resize updates span geometry from prefix edges and reuses pooled row/span elements', async () => {
    const { grid, container, root } = await createGrid(TWO_GROUPS);
    const header = root.querySelector(`.${CSS.HEADER}`)!;
    const groupRow = header.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)!;
    const spansBefore = Array.from(
      groupRow.querySelectorAll<HTMLDivElement>(`.${GROUP_HEADER_SPAN_CLASS}`),
    );
    expect(spansBefore.length).toBeGreaterThanOrEqual(2);

    const replaceSpy = vi.spyOn(groupRow, 'replaceChildren');

    grid.setColumnWidth('name', 150);
    await flushRenders();

    expect(replaceSpy).not.toHaveBeenCalled();
    expect(header.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)).toBe(groupRow);
    const spansAfter = Array.from(
      groupRow.querySelectorAll<HTMLDivElement>(`.${GROUP_HEADER_SPAN_CLASS}`),
    );
    expect(spansAfter[0]).toBe(spansBefore[0]);
    expect(spansAfter[1]).toBe(spansBefore[1]);

    expect(spanSnapshot(header)).toEqual([
      { text: 'Profile', left: '0px', width: '250px' },
      { text: 'Finance', left: '250px', width: '200px' },
    ]);

    replaceSpy.mockRestore();
    grid.destroy();
    container.remove();
  });

  // ── 5. Horizontal virtualization + DOM reuse ───────────────────────

  it('horizontal scroll filters by center window with lane-local geometry and reuses group DOM after warmup', async () => {
    // Enough wide leaves that a narrow viewport cannot hold every group at once
    // (slot count = visible + 2*buffer; need columnCount > that).
    const columns: LightFastGridColumnInput[] = [];
    for (let g = 0; g < 6; g++) {
      columns.push({
        headerName: `G${g}`,
        groupId: `g${g}`,
        children: [
          { field: `c${g}a`, headerName: `C${g}a`, width: 200 },
          { field: `c${g}b`, headerName: `C${g}b`, width: 200 },
        ],
      });
    }

    const { grid, container, root } = await createGrid(
      columns,
      { suppressColumnVirtualization: false },
      { height: '300px', width: '320px' },
    );

    const viewport = root.querySelector<HTMLElement>(`.${CSS.VIEWPORT}`)!;
    Object.defineProperty(viewport, 'clientWidth', {
      value: 320,
      configurable: true,
    });
    Object.defineProperty(viewport, 'clientHeight', {
      value: 300,
      configurable: true,
    });
    (getRenderer(grid) as unknown as { onViewportResize(): void }).onViewportResize();
    await flushRenders();

    const header = root.querySelector(`.${CSS.HEADER}`)!;
    const groupRow = header.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)!;
    expect(groupRow).toBeTruthy();

    const atStart = spanSnapshot(header);
    const startLabels = atStart.map((s) => s.text);
    expect(startLabels).toContain('G0');
    expect(startLabels).not.toContain('G5');
    expect(atStart.find((s) => s.text === 'G0')).toEqual({
      text: 'G0',
      left: '0px',
      width: '400px',
    });
    const semanticStart = Array.from(
      header.querySelectorAll<HTMLElement>(`.${GROUP_HEADER_SPAN_CLASS}`),
    ).find((span) => span.textContent.trim() === 'G0')!;
    expect(semanticStart.getAttribute('role')).toBe('columnheader');
    expect(semanticStart.getAttribute('aria-colindex')).toBe('1');
    expect(semanticStart.getAttribute('aria-colspan')).toBe('2');

    // Scroll near the end of the 2400px total width.
    scrollViewport(root, 1800);
    await flushRenders();
    await flushRenders();

    const atEnd = spanSnapshot(header);
    const endLabels = atEnd.map((s) => s.text);
    expect(endLabels).toContain('G5');
    expect(endLabels).not.toContain('G0');
    // Lane-local: G5 starts at 2000px, not window-local 0.
    expect(atEnd.find((s) => s.text === 'G5')).toEqual({
      text: 'G5',
      left: '2000px',
      width: '400px',
    });
    const semanticEnd = Array.from(
      header.querySelectorAll<HTMLElement>(`.${GROUP_HEADER_SPAN_CLASS}`),
    ).find((span) => span.textContent.trim() === 'G5')!;
    expect(semanticEnd.getAttribute('role')).toBe('columnheader');
    expect(semanticEnd.getAttribute('aria-colindex')).toBe('11');
    expect(semanticEnd.getAttribute('aria-colspan')).toBe('2');
    const hiddenSpans = Array.from(
      header.querySelectorAll<HTMLElement>(`.${GROUP_HEADER_SPAN_CLASS}`),
    ).filter((span) => span.style.display === 'none');
    for (const hidden of hiddenSpans) {
      expect(hidden.getAttribute('role')).toBeNull();
      expect(hidden.getAttribute('aria-colspan')).toBeNull();
      expect(hidden.getAttribute('data-lfg-group-start-field')).toBeNull();
      expect(hidden.getAttribute('data-lfg-group-end-field')).toBeNull();
      expect(hidden.getAttribute('data-lfg-group-leaf-count')).toBeNull();
    }

    // Warm both windows, then assert DOM reuse on further scrolls.
    scrollViewport(root, 0);
    await flushRenders();
    scrollViewport(root, 1800);
    await flushRenders();

    const warmedRow = header.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)!;
    const warmedSpans = Array.from(
      warmedRow.querySelectorAll<HTMLDivElement>(`.${GROUP_HEADER_SPAN_CLASS}`),
    );
    const spanCount = warmedSpans.length;
    const replaceSpy = vi.spyOn(warmedRow, 'replaceChildren');

    scrollViewport(root, 0);
    await flushRenders();
    scrollViewport(root, 1800);
    await flushRenders();
    scrollViewport(root, 900);
    await flushRenders();
    scrollViewport(root, 0);
    await flushRenders();

    expect(replaceSpy).not.toHaveBeenCalled();
    expect(header.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)).toBe(warmedRow);
    const afterSpans = Array.from(
      warmedRow.querySelectorAll<HTMLDivElement>(`.${GROUP_HEADER_SPAN_CLASS}`),
    );
    expect(afterSpans).toHaveLength(spanCount);
    for (let i = 0; i < spanCount; i++) {
      expect(afterSpans[i]).toBe(warmedSpans[i]);
    }

    replaceSpy.mockRestore();
    grid.destroy();
    container.remove();
  });
});
