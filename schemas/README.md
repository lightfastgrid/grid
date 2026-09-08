# Playground datasets

Static JSON served to both playgrounds at `/grid-demo/schemas/*`. These files
are not bundled into the app JavaScript.

| File | Rows |
| --- | --- |
| `lightfastgrid-customer-operations-1k.json` | 1,000 (default) |
| `lightfastgrid-customer-operations-10k.json` | 10,000 |
| `lightfastgrid-customer-operations-100k.json` | 100,000 |
| `grid-demo-datasets.json` | Manifest of the tiers above |

The 1,000,000-row tier is not a static file. It requires the block-loading
demo path.

Source for generation is
`apps/playgroundReact/src/gridDemo/schemas/ag-grid-100000x22-with-columns.json`.

From the repository root:

```bash
pnpm generate:grid-demo-datasets
```

To load 10k or 100k in a playground, change `GRID_DEMO_DATASET_FILE` in
`apps/playgroundReact/src/gridDemo/schemas/datasetPath.ts` and
`apps/playgroundJavascript/src/gridDemo/schemas/datasetPath.ts`.
