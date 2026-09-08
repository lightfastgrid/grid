# LightFastGrid Vanilla playground

Public example of `@lightfastgrid/core` without React. After `pnpm dev`, it
loads `schemas/lightfastgrid-customer-operations-1k.json` from the repository
root at runtime (not bundled) and demonstrates virtualization, Quick Search,
sorting, column filters, column visibility, pagination, column sizing and
ordering, row selection, inline editing, CSV export, and worker-assisted
execution.

The main grid configuration lives in `src/gridDemo/gridDemo.ts` and
`src/gridDemo/config/`.

Generated demo JSON (1k, 10k, 100k) lives in the repository-root
[`schemas/`](../../schemas) folder.

## Run

From the monorepo root:

```bash
pnpm --filter playground-javascript dev
```

Or from this directory:

```bash
pnpm dev
```

## Learn more

- React and Vanilla documentation: https://lightfastgrid.com/docs
- Performance evidence: https://lightfastgrid.com/benchmarks
