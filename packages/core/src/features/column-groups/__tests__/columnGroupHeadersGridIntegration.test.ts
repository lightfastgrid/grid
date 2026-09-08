// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { Grid } from '../../../Grid';
import type {
  LightFastGridColumnInput,
  LightFastGridProps,
  RowData,
} from '../../../types';
import {
  GROUP_HEADER_ROW_CLASS,
  GROUP_HEADER_SPAN_CLASS,
} from '..';

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

const GROUPED_COLUMNS: LightFastGridColumnInput[] = [
  {
    headerName: 'Profile',
    children: [
      { field: 'name', headerName: 'Name', width: 100 },
      { field: 'email', headerName: 'Email', width: 100 },
    ],
  },
  {
    headerName: 'Finance',
    children: [
      { field: 'bank', headerName: 'Bank', width: 100 },
      { field: 'rating', headerName: 'Rating', width: 100 },
    ],
  },
];

const FLAT_COLUMNS: LightFastGridColumnInput[] = [
  { field: 'name', headerName: 'Name', width: 100 },
  { field: 'email', headerName: 'Email', width: 100 },
];

const ROWS: RowData[] = [
  { id: '1', name: 'Alice', email: 'a@x.com', bank: 10, rating: 5 },
  { id: '2', name: 'Bob', email: 'b@x.com', bank: 20, rating: 4 },
];

async function createGrid(props: Partial<LightFastGridProps> = {}) {
  const container = document.createElement('div');
  Object.assign(container.style, { height: '400px', width: '800px' });
  document.body.appendChild(container);

  const grid = new Grid({
    columns: GROUPED_COLUMNS,
    rows: ROWS,
    getRowId: (row: RowData) => String(row.id),
    suppressRowVirtualization: true,
    suppressColumnVirtualization: true,
    ...props,
  });
  grid.mount(container);
  await flushRenders();
  return { grid, container };
}

describe('column group headers Grid integration', () => {
  it('renders group labels in real Grid DOM above leaf headers', async () => {
    const { grid, container } = await createGrid();
    const root = container.querySelector<HTMLElement>('.lfg-grid')!;

    const groupRows = root.querySelectorAll(`.${GROUP_HEADER_ROW_CLASS}`);
    expect(groupRows.length).toBeGreaterThan(0);

    const groupLabels = Array.from(
      root.querySelectorAll(`.${GROUP_HEADER_SPAN_CLASS}`),
    ).map((el) => el.textContent!.trim());
    expect(groupLabels).toEqual(expect.arrayContaining(['Profile', 'Finance']));

    const groupSpans = Array.from(
      root.querySelectorAll<HTMLElement>(`.${GROUP_HEADER_SPAN_CLASS}`),
    );
    const profile = groupSpans.find((span) => span.textContent.trim() === 'Profile')!;
    const finance = groupSpans.find((span) => span.textContent.trim() === 'Finance')!;
    expect(profile.getAttribute('role')).toBe('columnheader');
    expect(profile.getAttribute('aria-colindex')).toBe('1');
    expect(profile.getAttribute('aria-colspan')).toBe('2');
    expect(finance.getAttribute('role')).toBe('columnheader');
    expect(finance.getAttribute('aria-colindex')).toBe('3');
    expect(finance.getAttribute('aria-colspan')).toBe('2');
    expect(profile.hasAttribute('aria-owns')).toBe(false);
    expect(groupRows[0]!.getAttribute('role')).toBe('row');
    expect(groupRows[0]!.getAttribute('aria-rowindex')).toBe('1');

    const leafLabels = Array.from(root.querySelectorAll('.lfg-header-label')).map(
      (el) => el.textContent!.trim(),
    );
    expect(leafLabels).toEqual(
      expect.arrayContaining(['Name', 'Email', 'Bank', 'Rating']),
    );

    const header = root.querySelector('.lfg-header')!;
    const firstGroup = header.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)!;
    const leaf = header.querySelector('.lfg-header-row')!;
    expect(leaf.getAttribute('role')).toBe('row');
    expect(leaf.getAttribute('aria-rowindex')).toBe('2');
    expect(firstGroup.compareDocumentPosition(leaf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it('flat grid has no group rows and does not reserve group height', async () => {
    const { grid, container } = await createGrid({ columns: FLAT_COLUMNS });
    const root = container.querySelector<HTMLElement>('.lfg-grid')!;

    expect(root.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)).toBeNull();
    expect(root.querySelector(`.${GROUP_HEADER_SPAN_CLASS}`)).toBeNull();

    const headerHeight = root.style.getPropertyValue('--lfg-header-height');
    const baseHeight = root.style.getPropertyValue('--lfg-base-header-height');
    expect(headerHeight).toBe(baseHeight);

    grid.destroy();
    container.remove();
  });

  it('grouped + floating filters: group -> leaf -> floating-filter order', async () => {
    const { grid, container } = await createGrid({
      floatingFilters: true,
      defaultColDef: { filterable: true },
    });
    const root = container.querySelector<HTMLElement>('.lfg-grid')!;
    const header = root.querySelector('.lfg-header')!;
    const children = Array.from(header.children);

    const groupIdx = children.findIndex((el) =>
      el.classList.contains(GROUP_HEADER_ROW_CLASS),
    );
    const leafIdx = children.findIndex((el) => el.classList.contains('lfg-header-row'));
    const filterIdx = children.findIndex((el) =>
      el.classList.contains('lfg-floating-filter-row'),
    );

    expect(groupIdx).toBeGreaterThanOrEqual(0);
    expect(leafIdx).toBeGreaterThan(groupIdx);
    expect(filterIdx).toBe(leafIdx + 1);

    const base = Number.parseFloat(root.style.getPropertyValue('--lfg-base-header-height'));
    const total = Number.parseFloat(root.style.getPropertyValue('--lfg-header-height'));
    // depth 1 group row + floating filter (matches row height)
    expect(total).toBe(base + base + base);

    grid.destroy();
    container.remove();
  });

  it('pinned-left/right group rows appear before their pinned leaf rows', async () => {
    const columns: LightFastGridColumnInput[] = [
      {
        headerName: 'LeftGroup',
        children: [
          { field: 'name', headerName: 'Name', width: 100, pinned: 'left' },
        ],
      },
      {
        headerName: 'CenterGroup',
        children: [{ field: 'email', headerName: 'Email', width: 100 }],
      },
      {
        headerName: 'RightGroup',
        children: [
          { field: 'bank', headerName: 'Bank', width: 100, pinned: 'right' },
        ],
      },
    ];

    const { grid, container } = await createGrid({ columns });
    const root = container.querySelector<HTMLElement>('.lfg-grid')!;

    const leftStack = root.querySelector('.lfg-pinned-left-header-stack')!;
    const rightStack = root.querySelector('.lfg-pinned-right-header-stack')!;

    const leftGroup = leftStack.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)!;
    const leftLeaf = leftStack.querySelector('.lfg-pinned-header-row')!;
    expect(leftGroup.textContent).toContain('LeftGroup');
    expect(leftGroup.nextElementSibling).toBe(leftLeaf);

    const rightGroup = rightStack.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)!;
    const rightLeaf = rightStack.querySelector('.lfg-pinned-right-header-row')!;
    expect(rightGroup.textContent).toContain('RightGroup');
    expect(rightGroup.nextElementSibling).toBe(rightLeaf);

    const centerGroup = root
      .querySelector('.lfg-header')!
      .querySelector(`.${GROUP_HEADER_SPAN_CLASS}`);
    expect(centerGroup?.textContent).toBe('CenterGroup');

    grid.destroy();
    container.remove();
  });

  it('center group span left includes left-pinned width in global header coordinates', async () => {
    const pinnedWidth = 44;
    const { grid, container } = await createGrid({
      columns: [
        {
          headerName: 'Center',
          children: [
            { field: 'name', headerName: 'Name', width: 100 },
            { field: 'email', headerName: 'Email', width: 100 },
          ],
        },
      ],
      rowSelection: {
        mode: 'multiple',
        checkboxes: true,
        headerCheckbox: true,
        checkboxColumn: { pinned: 'left', width: pinnedWidth },
      },
    });
    const root = container.querySelector<HTMLElement>('.lfg-grid')!;
    const header = root.querySelector('.lfg-header')!;
    const span = header.querySelector(`.${GROUP_HEADER_SPAN_CLASS}`) as HTMLDivElement;
    expect(span.textContent).toBe('Center');
    expect(span.style.left).toBe(`${pinnedWidth}px`);
    expect(span.style.width).toBe('200px');

    // Leaf headers use CSS vars in the same global coordinate space.
    expect(root.style.getPropertyValue('--lfg-left-pinned-width')).toBe(`${pinnedWidth}px`);
    expect(root.style.getPropertyValue('--col-name-left')).toBe(`${pinnedWidth}px`);

    grid.destroy();
    container.remove();
  });

  it('center group span left stays lane-local when nothing is left-pinned', async () => {
    const { grid, container } = await createGrid({
      columns: [
        {
          headerName: 'Center',
          children: [
            { field: 'name', headerName: 'Name', width: 100 },
            { field: 'email', headerName: 'Email', width: 100 },
          ],
        },
      ],
    });
    const root = container.querySelector<HTMLElement>('.lfg-grid')!;
    const span = root
      .querySelector('.lfg-header')!
      .querySelector(`.${GROUP_HEADER_SPAN_CLASS}`) as HTMLDivElement;
    expect(span.style.left).toBe('0px');
    expect(span.style.width).toBe('200px');

    grid.destroy();
    container.remove();
  });

  it('effective header height is base + depth * headerHeight without floating filters', async () => {
    const { grid, container } = await createGrid();
    const root = container.querySelector<HTMLElement>('.lfg-grid')!;
    const base = Number.parseFloat(root.style.getPropertyValue('--lfg-base-header-height'));
    const total = Number.parseFloat(root.style.getPropertyValue('--lfg-header-height'));
    expect(total).toBe(base + base); // depth 1

    grid.destroy();
    container.remove();
  });

  it('columnGroupHeaders: false suppresses group rows without changing leaf fields', async () => {
    const { grid, container } = await createGrid({ columnGroupHeaders: false });
    const root = container.querySelector<HTMLElement>('.lfg-grid')!;

    expect(root.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)).toBeNull();
    expect(grid.isColumnGroupHeadersEnabled()).toBe(false);

    const leafLabels = Array.from(root.querySelectorAll('.lfg-header-label')).map(
      (el) => el.textContent!.trim(),
    );
    expect(leafLabels).toEqual(
      expect.arrayContaining(['Name', 'Email', 'Bank', 'Rating']),
    );

    const headerHeight = root.style.getPropertyValue('--lfg-header-height');
    const baseHeight = root.style.getPropertyValue('--lfg-base-header-height');
    expect(headerHeight).toBe(baseHeight);

    grid.destroy();
    container.remove();
  });

  it('setColumnGroupHeaders toggles group rows at runtime without setColumns', async () => {
    const { grid, container } = await createGrid();
    const root = container.querySelector<HTMLElement>('.lfg-grid')!;

    expect(root.querySelectorAll(`.${GROUP_HEADER_ROW_CLASS}`).length).toBeGreaterThan(0);

    grid.setColumnGroupHeaders(false);
    await flushRenders();
    expect(root.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)).toBeNull();
    expect(grid.isColumnGroupHeadersEnabled()).toBe(false);

    const leafLabelsOff = Array.from(root.querySelectorAll('.lfg-header-label')).map(
      (el) => el.textContent!.trim(),
    );
    expect(leafLabelsOff).toEqual(
      expect.arrayContaining(['Name', 'Email', 'Bank', 'Rating']),
    );

    grid.setColumnGroupHeaders(true);
    await flushRenders();
    expect(root.querySelectorAll(`.${GROUP_HEADER_ROW_CLASS}`).length).toBeGreaterThan(0);
    expect(grid.isColumnGroupHeadersEnabled()).toBe(true);

    grid.destroy();
    container.remove();
  });
});
