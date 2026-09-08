# LightFastGrid React playground

Public example of `@lightfastgrid/react`. It loads a 100,000 × 22 customer
dataset at runtime and demonstrates virtualization, Quick Search, sorting,
column filters, column visibility, pagination, column sizing and ordering,
row selection, inline editing, CSV export, and worker-assisted execution.

The main grid configuration lives in `src/gridDemo/gridDemo.tsx` and
`src/gridDemo/config/`.

## Run

From the monorepo root:

```bash
pnpm --filter playground-react dev
```

Or from this directory:

```bash
pnpm dev
```

## Learn more

- React and Vanilla documentation: https://lightfastgrid.com/docs
- Performance evidence: https://lightfastgrid.com/benchmarks
