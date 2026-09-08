# LightFastGrid

LightFastGrid is a performance-first JavaScript data grid for large
client-side datasets. This repository contains the MIT-licensed,
framework-agnostic Core package and the official React integration.

## Packages

| Package | Use it when |
| --- | --- |
| [`@lightfastgrid/core`](./packages/core) | You use Vanilla JavaScript or are building a framework integration. |
| [`@lightfastgrid/react`](./packages/react) | You use React 18 or newer. Core is installed automatically. |

## Install

React:

```bash
npm install @lightfastgrid/react
```

Vanilla JavaScript:

```bash
npm install @lightfastgrid/core
```

## React quick start

```tsx
import { LightFastGrid } from "@lightfastgrid/react";

const rows = [
  { id: "order-1001", customer: "Acme", total: 1200 },
  { id: "order-1002", customer: "Globex", total: 850 },
];

const columns = [
  { field: "customer", headerName: "Customer" },
  { field: "total", headerName: "Total" },
];

export function OrdersGrid() {
  return (
    <LightFastGrid
      rows={rows}
      columns={columns}
      getRowId={(row) => String(row.id)}
      height={420}
      accessibility={{ ariaLabel: "Orders" }}
    />
  );
}
```

The React package loads the default LightFastGrid theme. Give the component a
real height, or place it inside a parent with a non-zero height.

## Vanilla JavaScript quick start

```html
<div id="orders-grid"></div>
```

```css
#orders-grid {
  height: 420px;
}
```

```js
import { Grid } from "@lightfastgrid/core";
import "@lightfastgrid/core/themes/default.css";

const host = document.getElementById("orders-grid");

if (!(host instanceof HTMLElement)) {
  throw new Error("Missing #orders-grid");
}

const grid = new Grid({
  rows: [
    { id: "order-1001", customer: "Acme", total: 1200 },
    { id: "order-1002", customer: "Globex", total: 850 },
  ],
  columns: [
    { field: "customer", headerName: "Customer" },
    { field: "total", headerName: "Total" },
  ],
  getRowId: (row) => String(row.id),
  accessibility: { ariaLabel: "Orders" },
});

grid.mount(host);

export function disposeOrdersGrid() {
  grid.destroy();
}
```

Call `disposeOrdersGrid()` when the application permanently removes the grid
host view.

## Highlights

- Virtualized rows and columns
- Sorting, column filters, and Quick Search
- Row and column selection
- Cell editing, menus, actions, and accessible overlays
- Column sizing, ordering, visibility, pinning, and grouped headers
- Pagination and CSV export
- Keyboard navigation and WAI-ARIA grid semantics
- Worker-assisted execution for eligible sort, filter, search, and CSV work

## Documentation

- [React documentation](https://lightfastgrid.com/docs/react)
- [Vanilla JavaScript documentation](https://lightfastgrid.com/docs/vanilla)
- [Benchmarks and reproducible evidence](https://lightfastgrid.com/benchmarks)
- [LightFastGrid website](https://lightfastgrid.com)

Package-specific setup details are available in
[`packages/react/README.md`](./packages/react/README.md) and
[`packages/core/README.md`](./packages/core/README.md).

## License

LightFastGrid Core and the React integration are available under the
[MIT License](./LICENSE).
