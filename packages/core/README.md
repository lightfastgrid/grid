# LightFastGrid Core

`@lightfastgrid/core` is the framework-agnostic Vanilla JavaScript package for
LightFastGrid, a performance-first JavaScript data grid for large client-side
datasets.

The package is MIT licensed.

React applications should install `@lightfastgrid/react` instead. That package
depends on Core and owns the React lifecycle. See the
[React installation guide](https://lightfastgrid.com/docs/react/getting-started/installation).

## Install

```bash
npm install @lightfastgrid/core
```

```bash
pnpm add @lightfastgrid/core
```

```bash
yarn add @lightfastgrid/core
```

Public TypeScript declarations ship with the package. Do not install a separate
`@types` package.

## Quick start

Give the host a real height. The grid fills that element and virtualizes inside
it.

```css
#orders-grid {
  height: min(70vh, 640px);
}
```

```html
<div id="orders-grid"></div>
```

```js
import { Grid } from "@lightfastgrid/core";
import "@lightfastgrid/core/themes/default.css";

const host = document.getElementById("orders-grid");

if (!(host instanceof HTMLElement)) {
  throw new Error("Missing #orders-grid");
}

const grid = new Grid({
  columns: [
    { field: "customer", headerName: "Customer" },
    { field: "total", headerName: "Total" },
  ],
  rows: [
    { id: "order-1001", customer: "Acme", total: 1200 },
    { id: "order-1002", customer: "Globex", total: 850 },
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

`getRowId` must return a unique, stable id for every row. Do not derive it from
the row's current position. Sorting, filtering, and updates can move that row.

Core does not inject the default stylesheet. Import
`@lightfastgrid/core/themes/default.css` once from a browser entry module or
shared stylesheet boundary.

A modern application bundler is the recommended delivery path. The package
publishes ESM and CommonJS entries. It does not expose a classic UMD global for
an unbundled `<script>` tag.

## Features

- Virtualized rows and columns
- Sorting, filtering, and quick search
- Row and column selection
- Cell editing
- Column pinning, grouped headers, and pagination
- Keyboard navigation and WAI-ARIA grid semantics
- CSV export
- Worker-assisted execution for eligible sort, filter, search, and CSV work

Feature contracts, examples, and the runtime API live in the documentation.

## Documentation

- [Vanilla quick start](https://lightfastgrid.com/docs/vanilla/getting-started/quick-start)
- [Installation](https://lightfastgrid.com/docs/vanilla/getting-started/installation)
- [Runtime grid API](https://lightfastgrid.com/docs/vanilla/api-events-and-export/runtime-grid-api)
- [Vanilla documentation](https://lightfastgrid.com/docs/vanilla)
- [Benchmarks](https://lightfastgrid.com/benchmarks)
- [GitHub](https://github.com/lightfastgrid/grid)
- [Issues](https://github.com/lightfastgrid/grid/issues)

## License

MIT. See [LICENSE](./LICENSE).
