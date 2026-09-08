# LightFastGrid React playground

Public example of `@lightfastgrid/react`. After `pnpm dev`, it loads
`schemas/lightfastgrid-customer-operations-1k.json` from the repository root
at runtime (not bundled) and demonstrates virtualization, Quick Search,
sorting, column filters, column visibility, pagination, column sizing and
ordering, row selection, inline editing, CSV export, and worker-assisted
execution.

The main grid configuration lives in `src/gridDemo/gridDemo.tsx` and
`src/gridDemo/config/`.

The 100,000 × 22 source file is `src/gridDemo/schemas/ag-grid-100000x22-with-columns.json`.
Generated demo JSON (1k, 10k, 100k) lives in the repository-root [`schemas/`](../../schemas)
folder. Regenerate with `pnpm generate:grid-demo-datasets` from the monorepo
root, or `pnpm generate:grid-demo-dataset:10k` / `:100k` from this directory.

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
