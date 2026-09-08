# LightFastGrid for React

`@lightfastgrid/react` is the React package for LightFastGrid, a
performance-first JavaScript data grid for large client-side datasets.

The package is MIT licensed. It requires `react` and `react-dom` version 18 or
newer.

## Install

```bash
npm install @lightfastgrid/react
```

```bash
pnpm add @lightfastgrid/react
```

```bash
yarn add @lightfastgrid/react
```

`@lightfastgrid/core` is a runtime dependency and is installed automatically.
React applications normally install only `@lightfastgrid/react`.

The React package loads the default LightFastGrid theme. Do not import
`@lightfastgrid/core/themes/default.css` again in normal React usage.

Public TypeScript declarations ship with the package. Do not install a separate
`@types` package.

## Quick start

```tsx
import { LightFastGrid } from "@lightfastgrid/react";

type Order = {
  id: string;
  customer: string;
  total: number;
};

const rows: Order[] = [
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

`getRowId` must return a unique, stable id for every row. Do not derive it from
the row's current position. Sorting, filtering, and updates can move that row.

## Container sizing

The grid fills its parent. Set `height` on `LightFastGrid`, or give the parent
a real height and let the component's default `height: 100%` fill that parent.

A blank or clipped grid is usually a sizing problem, not a data problem.

## Next.js and App Router

LightFastGrid mounts into a real browser `HTMLElement`. In a Next.js App Router
application, render the grid from a Client Component:

```tsx
"use client";

import { LightFastGrid } from "@lightfastgrid/react";
```

Client-only React applications, such as a Vite single-page app, do not need the
`"use client"` directive.

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

- [React quick start](https://lightfastgrid.com/docs/react/getting-started/quick-start)
- [Installation](https://lightfastgrid.com/docs/react/getting-started/installation)
- [React documentation](https://lightfastgrid.com/docs/react)
- [Benchmarks](https://lightfastgrid.com/benchmarks)
- [GitHub](https://github.com/lightfastgrid/grid)
- [Issues](https://github.com/lightfastgrid/grid/issues)

## License

MIT. See [LICENSE](./LICENSE).
