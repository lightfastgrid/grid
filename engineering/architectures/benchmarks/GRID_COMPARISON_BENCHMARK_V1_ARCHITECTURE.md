# Grid Comparison Benchmark V1 Architecture

> Public methodology source of truth: this document and `benchmarks/README.md`.
>
> Feature source of truth after approval: this document.
>
> Implementation of this isolated harness was authorized by the repository
> owner in the same request that froze the contract below. This document does
> not change Core or React runtime algorithms. Packed Core Worker URL
> packaging is in scope so consumer Vite builds emit Worker assets.

## Document Status

| Field | Value |
| --- | --- |
| Status | Implementing |
| Owner | LightFastGrid |
| Version | V1 |
| Last reviewed | 2026-09-07 |
| Public documentation | `benchmarks/README.md` (lab harness) |
| Research | AG Grid 36 Community quick start, Theming API, `AllCommunityModule` |
| Benchmark status | Required for this harness; no numeric results are claimed in V1 |

## 1. Executive Decision

V1 is an isolated root-level `benchmarks/` workspace that builds six
equivalent production applications in **two independent comparison lanes**.

**React lane**

1. `@lightfastgrid/react` installed from locally packed npm tarballs
2. AG Grid React Community 36.1.0 with `AllCommunityModule`
3. A React-only baseline used only to quantify shared React application overhead

**Vanilla lane**

1. `@lightfastgrid/core` installed from the same locally packed Core tarball
2. AG Grid Community Vanilla 36.1.0 with documented `createGrid` and
   `AllCommunityModule`
3. A framework-free Vanilla baseline used only to quantify shared Vanilla
   application overhead

The React application directories are not renamed. Vanilla apps are additional.
React results and Vanilla results must not be mixed, subtracted across lanes,
or combined into one percentage.

The harness measures production bundle sizes and a Chromium Playwright
runtime protocol. It does not publish packages, does not import LightFastGrid
from workspace source, and does not fabricate timing or size ranking claims.
Bundle size does not prove runtime speed.

AG Grid Community is the comparison target because it is MIT licensed, has
documented React and Vanilla quick starts, and `AllCommunityModule` is the
documented full-Community bundle. That configuration is recorded in benchmark
metadata. Paid Enterprise modules are out of scope.

## 2. Problem Statement

Public comparison pages and demos cannot substitute for a reproducible lab
that installs LightFastGrid the way a consumer would: from packed artifacts,
not from this repository's workspace links.

### 2.1 User scenarios

1. A fresh checkout prepares local Core and React tarballs and installs the
   LightFastGrid React app from both files and the LightFastGrid Vanilla app
   from the Core tarball only.
2. The same scenarios, columns, seed, row IDs, and values feed every grid app.
3. Production Vite builds emit comparable JS/CSS payloads that a Node script
   measures with fixed gzip and Brotli options, reported in two lanes.
4. Playwright Chromium calls `window.__GRID_BENCHMARK__` on `dist/runtime`
   without both grids being mounted at once.
5. The `extreme` scenario is available but never starts unless explicitly
   selected.

### 2.2 Goals

- Reproducible local-tarball installation of `@lightfastgrid/core` and
  `@lightfastgrid/react` (React lane) and Core-only for the Vanilla lane.
- Equivalent grid configuration for a virtualization baseline in each lane.
- Shared compact scenario/column/value-pool JSON with deterministic row
  generation. Vanilla apps import framework-neutral shared modules only.
- Production bundle accounting with a matching framework baseline per lane.
- A stable browser protocol, environment capture, and Phase 1 Playwright
  Chromium runner for `dist/runtime`.
- Packed Core Worker files under `dist/assets` addressed relative to
  `import.meta.url` (or CJS `pathToFileURL(__dirname)`), never site-root
  `/assets/`.

### 2.3 Non-goals

- Publishing anything to npm.
- Changing Core or React runtime algorithms, Worker eligibility, or theme
  implementation to improve results.
- Adding TanStack Table or AG Grid Enterprise.
- Committing generated 200,000 × 100 datasets or fabricated result files.
- Fabricating runtime numbers or pasting them into React components.
- Combining React and Vanilla runtime results.
- Including benchmark apps in playground or other application production builds.
- Claiming “fastest” or “best”.

### 2.4 Shipped V1 scope

- Isolated `benchmarks/` pnpm workspace, not part of the root workspace.
- Prepare, install-verify, production-build, bundle-measure, preview, and
  environment capture scripts.
- Six Vite applications with identical production settings in two lanes.
- Shared scenarios `normal`, `large-rows`, `wide`, and opt-in `extreme`.
- Typed `window.__GRID_BENCHMARK__` protocol with documented completion
  boundaries.
- Root scripts `benchmark:prepare`, `benchmark:build`,
  `benchmark:bundle-sizes`, `benchmark:runtime:smoke`, `benchmark:runtime`,
  `benchmark:runtime:native`, `benchmark:runtime:trace`,
  `benchmark:runtime:install`, and `benchmark:verify`.
- Typecheck of all six apps and Worker-asset verification of packed Core
  and both LightFastGrid consumer dists.
- Automated proof that Vanilla apps have no React/ReactDOM declaration or
  production-bundle inclusion.
- Phase 1 Playwright Chromium runtime harness for mount, sort, isolated
  column-filter scenarios, Quick Search, reset, and scroll on the four grid
  apps. Ordinary competitive operations use one canonical LightFastGrid
  identity. Quick Search mode slots remain Quick Search only. The public
  candidate workload is 100,000 × 50. Public runtime figures come only from
  a promoted `publish-native` artifact.

## 3. Terminology

| Term | Meaning |
| --- | --- |
| Packed tarball | Output of `pnpm pack` for Core or React, copied to a stable filename under `benchmarks/artifacts/` |
| Workspace leak | Resolution of `@lightfastgrid/*` to `packages/core` or `packages/react` source or a symlink thereto |
| Default scenarios | `normal`, `large-rows`, `wide` — used by automatic verification |
| Opt-in scenario | `extreme` — memory-intensive; requires explicit selection |
| Completion boundary | Accepted grid event (or equivalent API settlement) plus two animation frames |
| Incremental grid estimate | Application **bundle-mode** total minus the **matching** framework baseline; labeled as an estimate only, nested under `lanes.<lane>`. Never subtract across lanes. Never combine React and Vanilla percentages. |
| `workerIsolated` | LightFastGrid Quick Search with `quickFilter: { enabled: true, cache: false, prewarm: false }` and `execution.thresholds.quickSearch: 25_000` on the 100,000-row publish dataset. Direct completion producer must be `"worker"` or the sample is invalid. Pending state and row-count eligibility are not producer proof. |
| `mainThreadIsolated` / `forcedMainThread` | Same LightFastGrid algorithm and dataset as `workerIsolated`, except `execution.thresholds.quickSearch` is `ROW_COUNT + 1` so 100,000 rows stay on the immediate main-thread route. Not the default configuration and not a competitor. |
| `workerProductionOptimized` | Recommended production LightFastGrid config: `quickFilter: { enabled: true, cache: true, prewarm: true }` and `execution.thresholds.quickSearch: 25_000`. Preserve the exact producer. `"unknown"` is invalid. `"cache"` is a cache/prewarm result and is never Worker execution. `"mainThread"` below the Worker threshold is expected and valid. `"mainThread"` at or above the threshold is a retained product-performance sample, not Worker-performance evidence. `"worker"` at or above the threshold is Worker-performance evidence. |
| Typing burst | Primary interactive Quick Search UX: prefixes `P → Pa → Pat → Pate → Patel` at a fixed 120 ms cadence without waiting for intermediate settlement. Processing latency is final keystroke → final paint; cadence waits are not grid time. |
| Settled incremental | Diagnostic: each prefix is submitted only after the previous prefix settles. Not the primary real-user result. |
| Primary bundle result | Complete per-application JS+CSS payload from `dist/bundle`, not the estimate and not `dist/runtime` |
| Bundle mode | Minimal production consumer; public size figures; no `window.__GRID_BENCHMARK__` |
| Runtime mode | Instrumented protocol app for Playwright; excluded from public size totals |
| Smoke profile | 10,000 × 20, 1 warmup + 1 measured round, diagnostic only; not Worker evidence; never publishable |
| Publish profile | 100,000 × 50, 3 warmups + ≥10 measured rounds, 4× page CDP CPU throttle for main-thread/UX diagnostics. Chromium does not support `Emulation.setCPUThrottlingRate` on Worker targets; a 4× page with an unthrottled Worker is unequal compute and Worker-vs-main-thread numbers stay provisional/non-publishable |
| Publish-native profile | Same 100,000 × 50 public-candidate schedule as publish, but no CDP CPU throttling on page or Worker. Equal compute is native 1× machine speed. This is the fair profile for publishable Worker comparisons. It does not prove 4× throttled performance |
| Canonical product identity | LightFastGrid product-default configuration used for Mount, Sort, Filter, Reset, and Scroll. Quick Search mode slots do not contribute those operations |
| Neutral filter model | Shared `{ logic: "and", conditions }` protocol. Products translate it to public filter APIs. Operators and values are part of accepted state |
| Static preview verification | HTTP check that production HTML/JS assets exist and Vite can serve them. Does not execute the grid or protocol |
| React lane | `lightfastgrid`, `ag-grid`, `react-baseline` |
| Vanilla lane | `lightfastgrid-vanilla`, `ag-grid-vanilla`, `vanilla-baseline` |

## 4. Existing System Analysis

### 4.1 Current flow

- Core and React are workspace packages (`workspace:*`) consumed by
  playgrounds. That path is incorrect for consumer-bundle measurement.
- React already imports `@lightfastgrid/core/themes/default.css` from the
  adaptor. The LightFastGrid app also imports that production CSS explicitly.
- Core default layout is 40px row height and 150px column width at standard
  density (`DEFAULT_GRID_LAYOUT_METRICS`, `DEFAULT_COL_WIDTH`).
- Core overscan is `POOL_SIDE_BUFFER_ROWS = 5` per side and is not a public
  option. AG Grid `rowBuffer` is set to 5 to match that intent.
- Sort, filter, and quick-search complete through typed events
  (`sort:changed`, `filter:changed`, `quick-filter:changed`,
  `quick-search-pending:changed`).
- No isolated consumer-tarball benchmark workspace exists today.

### 4.2 Existing reusable infrastructure

| Capability | Existing owner | Reuse decision | Evidence |
| --- | --- | --- | --- |
| Core/React production build | `packages/core`, `packages/react` | Invoke via prepare. Worker URL packaging may be amended so packed consumers receive Worker assets; Worker algorithms must not change | package build scripts |
| Default theme CSS | `@lightfastgrid/core/themes/default.css` | Import in the LightFastGrid app | Core `exports` |
| Public marketing pages | Outside this repository | Do not reuse numbers or UI | marketing illustration, not lab data |
| Playground Vite aliases to source | `apps/playgroundReact/vite.config.ts` | Must not copy; would violate the tarball boundary | source aliases |

### 4.3 Current gaps and defects

- No packed-tarball consumer app.
- No shared deterministic lab dataset contract for competitor apps.
- No production bundle measurement with gzip/Brotli and baseline subtraction
  labeled as an estimate.
- Packed Core Worker constructors used site-root `/assets/` URLs, so a Vite
  consumer omitted Worker chunks. That packaging defect is fixed: ESM
  constructors use `new URL("./assets/*Worker-*.js", import.meta.url)`,
  verify/measure fail if Worker files or relative URLs are missing, and
  comparison numbers are not publishable without them.

### 4.4 Assumptions requiring verification

Resolved during implementation:

- `pnpm pack` of React records `@lightfastgrid/core` as the exact Core
  version. The prepare script **validates** that conversion and does not
  rewrite tarballs. Benchmark workspace overrides deliberately resolve Core
  and React to the local packed tarballs so a registry install cannot be used
  accidentally. Prepare refreshes the nested lockfile
  and `node_modules` so regenerated tarball integrity cannot go stale.
- Nested `benchmarks/` installs must ignore the parent pnpm workspace so
  `@lightfastgrid/*` cannot be linked from `packages/*`.
- AG Grid 36.1.0 Community Theming API (`themeQuartz`) is current; legacy
  `ag-grid.css` / `ag-theme-*` CSS imports are not used.

## 5. Public Contract

The harness contract is the browser protocol plus the Node scripts. It is not
a Core/React public API.

### 5.1 Browser protocol

```ts
type SortDirection = "asc" | "desc";

interface GridBenchmarkAcceptedState {
  sort: ReadonlyArray<{ field: string; direction: SortDirection }>;
  filterFields: string[];
  quickSearch: string;
}

interface GridBenchmarkVisibleState {
  displayedRowCount: number;
  renderedRowCount: number;
  firstRenderedRowId: string | null;
  lastRenderedRowId: string | null;
  scrollTop: number;
  scrollLeft: number;
  columnCount: number;
}

interface GridBenchmarkPrepareResult {
  scenario: string;
  rowCount: number;
  columnCount: number;
  generationMs: number;
}

interface GridBenchmarkProtocol {
  prepareScenario(name: string): Promise<GridBenchmarkPrepareResult>;
  mount(): Promise<void>;
  waitUntilReady(): Promise<void>;
  sort(field: string, direction: SortDirection): Promise<void>;
  filter(field: string, value: string | number): Promise<void>;
  quickSearch(text: string): Promise<void>;
  typeQuickSearch(options: {
    variant: "burst" | "settledIncremental";
    prefixes?: string[];
    intervalMs?: number;
  }): Promise<QuickSearchTypingSessionResult>;
  getQuickSearchExecutionEvidence(): QuickSearchExecutionEvidence;
  clearOperations(): Promise<void>;
  scrollTo(top: number, left: number): Promise<void>;
  getVisibleState(): GridBenchmarkVisibleState;
  getAcceptedState(): GridBenchmarkAcceptedState;
  getDomNodeCount(): number;
  destroy(): Promise<void>;
  getMeta(): GridBenchmarkMeta;
  getReactProfileSummary(): GridBenchmarkReactProfileSummary | null;
  startRuntimeObservers(): void;
  stopRuntimeObservers(): GridBenchmarkRuntimeSample | null;
}

interface Window {
  __GRID_BENCHMARK__?: GridBenchmarkProtocol;
}
```

`quickSearch(text)` waits for that text to settle and therefore cannot represent
uninterrupted typing by itself. `typeQuickSearch` is one protocol call: it
schedules each prefix at the fixed cadence without awaiting the previous
settlement (burst) or waits per prefix (settled incremental), records monotonic
timestamps, waits only after the final prefix in burst mode, validates accepted
final text `"Patel"` and the final displayed-row count, and rejects a stale
earlier result that replaces the final text. There is no arbitrary sleep after
the final character. Settlement uses accepted events, pending=false where
applicable, correctness gates, and the existing two-frame paint boundary. The
four grid apps and both baselines implement the same methods.

`prepareScenario("extreme")` throws unless the caller passes an explicit
opt-in (`allowExtreme: true` internally, exposed only when the URL contains
`extreme=1` or the protocol is invoked with `{ allowExtreme: true }` from a
future runner). Automatic page load never prepares `extreme`.

### 5.2 Grid and adapter props

Not applicable to Core/React public props. Each app maps shared column
descriptors onto that library’s public API only. LightFastGrid benchmark apps
select named Quick Search modes through public `quickFilter` and
`execution.thresholds.quickSearch` options. They do not change Core or React
algorithms. AG Grid uses `cacheQuickFilter: true` when the installed 36.1.0
surface supports it.

### 5.3 Configuration and defaults

| Option | Value |
| --- | --- |
| React / ReactDOM | `19.2.5` exact in the React lane; `"n/a"` in Vanilla metadata |
| Vite | `8.0.10` exact |
| `@vitejs/plugin-react` | `6.0.1` exact, React apps only |
| AG Grid React | `ag-grid-react@36.1.0`, `ag-grid-community@36.1.0` exact |
| AG Grid Vanilla | `ag-grid-community@36.1.0` exact, `createGrid`, no `ag-grid-react` |
| Viewport | 1280 × 720 px |
| Row height | 40 px |
| Header height | 40 px |
| Column width | 150 px |
| Overscan | LightFastGrid default (5 rows/side); AG Grid `rowBuffer: 5` |
| Pagination | off |
| Pinned columns | none |
| Custom cell renderers | none |
| Animations | off (`animateRows: false` on AG Grid) |
| Scenario seed | `20260906` |

### 5.4 Results, tasks, progress, and events

Bundle and environment JSON are written under `benchmarks/results/` at
measurement time. V1 does not commit those files and does not invent values.

### 5.5 Errors

| Error | Trigger |
| --- | --- |
| Missing tarball | Prepare/install before pack |
| Workspace leak | `@lightfastgrid/*` realpath under `packages/` |
| Packed version mismatch | React tarball Core dependency ≠ packed Core version |
| Unknown scenario | `prepareScenario` name not in `scenarios.json` |
| Extreme without opt-in | `extreme` selected without explicit allow |
| Operation before mount | Protocol methods that require a live grid |
| Absolute Worker URLs | Packed Core constructors use site-root `/assets/` |
| Missing consumer Workers | LightFastGrid dist omits sort/filter/quickSearch Worker JS |

### 5.6 Compatibility

Node `>=20` (implementation uses Node 22 JSON import attributes where
needed). pnpm `10.33.2`. Phase 1 runtime uses Playwright Chromium.

## 6. Observable Semantics

### 6.1 Ordering and precedence

`prepareScenario` (data generation, timed separately) → `mount` →
operations. `mount()` always includes `waitUntilReady()` for both grids, so
the mount-to-ready interval is `mount()`. `waitUntilReady()` remains
independently callable and is idempotent after mount. Generation time is
never added to mount or operation durations by the protocol.

Measured Quick Search work is isolated per scenario. Clearing accepted
Quick Search text is not enough: internal caches and Worker snapshots may
remain. Each scenario below remounts a fresh grid instance (unrecorded;
not mixed into `mount` statistics):

A. `coldFullQuery` — no prior Quick Search; submit `"Patel"` once.
B. `coldRealisticTyping` — no prior Quick Search; type `P → Pa → Pat →
   Pate → Patel` at 120 ms. This is the primary real-user typing result.
C. `primedDifferentQuery` — unrecorded priming query `"Morgan"`, wait for
   full settlement, clear accepted text without recreating the grid, then
   measure `"Patel"`. Priming time is excluded. Label is
   `primedDifferentQuery`, not `prewarmReady`.
D. `repeatedSameQuery` — unrecorded `"Patel"`, settle, clear accepted text
   without recreating the grid, then measure `"Patel"` again.
E. `settledIncremental` — diagnostic; each prefix settles before the next.
   Excluded from the primary realistic-typing comparison.

These boundaries are identical for LightFastGrid React, LightFastGrid
Vanilla, AG Grid React, and AG Grid Vanilla. LightFastGrid still exposes
`workerIsolated`, `mainThreadIsolated` / forced main thread, and
`workerProductionOptimized`. AG Grid runs one optimized baseline per
framework with `cacheQuickFilter: true`. Never reuse an AG sample across
incompatible scenario identities. Never use a repeated-query AG sample as
the cold-typing result.

After the isolated Quick Search scenarios, published `clearOperations` then
`scrollTo` run on the last instance.

`prepareScenario` destroys any live grid and releases the previous generated
row array (`rows.length = 0`) before allocating another scenario.

### 6.2 Empty and boundary cases

- No scenario prepared: `mount` rejects.
- Zero matching filter/search rows: `wait` still settles after the accepted
  event and two frames; visible state may have zero rendered body rows.
- Unknown field: the grid library’s public API error surfaces; the harness
  does not swallow it.

### 6.3 Mutations during an active operation

A new protocol call replaces in-flight work by awaiting the previous call on
a single serial queue. Destroy cancels the queue and unmounts. Typing burst
keystrokes are scheduled inside one `typeQuickSearch` call and must not go
through that serial queue per character.

### 6.4 Callback semantics

Completion is never claimed from an event that fires before rendering. The
boundary is:

1. the library’s accepted-state event or documented API settlement;
2. LightFastGrid Worker sort additionally waits until
   `.lfg-header-sort-pending` is absent (there is no public sort-pending event;
   `sort:changed` can fire when the SortModel is accepted, before rows commit);
3. LightFastGrid Quick Search additionally waits until
   `quick-search-pending` is false when pending was observed;
4. two `requestAnimationFrame` callbacks;
5. the timed operation ends. Correctness inspection is outside `durationMs`
   and must not mutate loading, overlays, filters, search, or rows.

LightFastGrid `displayedRowCount` after Quick Search must not use
`getRows().length` (source rows) and must not wait on a stale
`.lfg-grid-surface[aria-rowcount]` inside `durationMs`. Core has no public
displayed-row getter. Both React and Vanilla drivers inspect the current
processed/display row model through a benchmark-only adapter
(`Grid.state.captureReadSnapshot().fullView.rowCount`, with
`getSnapshot().rowView.rowCount` as fallback). AG Grid uses
`getDisplayedRowCount()`.

Unrecorded setup resets between Sort → Filter and Filter → Quick Search stay
excluded from the next operation’s statistics, but each reset is inspected:
empty SortModel, empty FilterModel, empty Quick Search, and full displayed-row
count. Page errors, console errors, and unhandled rejections are drained and
preserved. A failed setup reset invalidates the next operation with
`invalid-setup-state` and does not continue from contaminated state.

Harness failures during context create, preview start, page create, guard
attach, navigation, protocol discovery, throttling, preparation, operation,
teardown, or evidence write are collected and written from the outermost
`finally` boundary whenever the run directory exists (`errors.json`,
`schedule.json`, `environment.json`, `methodology.json`, partial
`raw-samples.json`, and a non-publishable `summary.json`). Partial runs set
`complete: false`, `publishable: false`, and a fatal reason, then fail the
Playwright run. Successful runs set `complete: true` and `fatalReason: null`.

If any primary harness failure exists, `fatalReason` is that root failure
formatted as `harness <phase>: <message>`. Missing valid-sample reasons stay
in `fatalRunReasons` as secondary diagnostics and must not replace the root
harness reason. Identical reasons are stored once. When no primary harness
failure exists, `fatalReason` is the first genuine fatal run reason, or
`run is incomplete`. Expected already-closed cleanup after a browser or test
timeout is recorded as a secondary teardown entry and is not a second root
failure.

Browser context, preview, page, and page-guard resources are nullable-owned.
Context creation happens inside the run-level guarded `try`. Each slot starts
preview, creates a page, and attaches guards inside a protected scope, then
navigates and discovers the protocol. Cleanup is reverse-order and
independent: detach guards, close page, stop preview, then close the context
if it was created. Runtime preview is a directly owned Vite Node process
spawned with `process.execPath` and the workspace Vite CLI, never `pnpm exec`
or a shell wrapper. `stop()` is idempotent: SIGTERM, bounded wait, SIGKILL
fallback, then wait until the owned PID has actually exited. Sending a signal
is not success. If exit cannot be confirmed, teardown fails. A child that
exits before HTTP readiness fails immediately with its exit code or signal
and bounded stderr. Active previews are registered so Playwright teardown,
SIGINT, and SIGTERM stop only this harness's owned processes. The first
SIGINT or SIGTERM awaits owned-process stop, prints cleanup failures, and
exits 130 (SIGINT) or 143 (SIGTERM). A second signal during shutdown
force-exits. `beforeExit` must not loop or reinstall handlers; it only
signals this harness's leftover PIDs. SIGKILL cannot be handled; that
limitation is documented. Production harness code must not `pkill`. A
preview that fails HTTP readiness still stops the owned process. If that
stop also fails, both errors are preserved (`AggregateError`); a clean
startup failure must not hide unconfirmed termination. A cleanup failure must not skip later cleanup. Trace stop
runs only when tracing started; a traced slot that failed writes
`trace.incomplete.zip`; trace-stop failure is recorded without blocking
page/preview cleanup and must not mark tracing complete. If benchmark
execution and evidence writing both fail, both errors are preserved through
`AggregateError`. Evidence-write failure after a successful measurement fails
the command. `orchestrator-complete.json` is written after the final
publication state is known and must never report `ok: true` after an
evidence-write or teardown failure.

Operation-level `p95SampleCountEligible` means only that the operation has
enough valid samples for a P95. Publication permission is exclusively
report-level `publishable`. Methodology records whether the profile intends
public-candidate statistics, whether P95 sample counts are sufficient, and
whether the report is complete. `publishable: true` requires `complete: true`.
Dirty, smoke, trace, incomplete, fatal, and Quick Search comparison-provisional
runs cannot be publishable. `collectQuickSearchComparisonReasons()` is computed
from the same comparison object that is written into `summary.json`, before
`resolveRunPublication()` decides `publishable`. A report must never have
`publishable: true` when `summary.quickSearchModeComparison.provisional` is
true, required producer evidence is missing, Worker equal-compute is
unconfirmed, or any required Quick Search comparison is methodologically
invalid. Schema validation rejects that combination.

Public-candidate profiles require every scheduled warmup slot to complete
successfully. One bounded retry uses a completely fresh page/grid slot and
never reuses failed warmup state. Retry exhaustion keeps both attempts in
evidence, marks the run incomplete/non-publishable with a precise warmup
reason, and does not let a later measured sample replace the missing warmup.
Secondary teardown failures must not replace the root warmup failure. Smoke
does not retry warmups; invalid warmup samples stay visible and smoke remains
non-publishable.

`clearOperations` inspects current models first, registers listeners, then
issues only the resets that change state. Already-empty models do not wait
for an event that will never fire. Listeners are always unsubscribed, including
timeout and error paths, with a bounded timeout.

Unavoidable difference: LightFastGrid may finish sort/filter/search on a
Worker above its default execution thresholds; AG Grid Community client-side
row model typically finishes those operations on the main thread. Both still
use the same completion boundary after the accepted event. Visible first/last
rendered row ids are the visually topmost/bottommost `.lfg-row` / `.ag-row`
nodes (sorted by `getBoundingClientRect().top`), not DOM source order, so
virtualized row recycling cannot satisfy sort checks with a stale first node.

AG Grid 36 Theming API scroll and visible `scrollTop`/`scrollLeft` use
`.ag-grid-viewport`. Legacy `.ag-body-viewport` is not emitted.

### 6.5 Quick Search typing and Worker-mode matrix

Do not benchmark Quick Search only by submitting `"Patel"` in one call. The
primary interactive test types `P → Pa → Pat → Pate → Patel`.

**Burst (primary UX).** 120 ms between keystrokes. For every prefix: wait
until the scheduled cadence deadline, capture the actual dispatch timestamp
immediately **before** `adapter.setText(prefix)`, store that timestamp as
the input timestamp, set `firstKeystrokeMs` / `lastKeystrokeMs` from that
pre-call timestamp, then call `setText`. Distinguish scheduled timestamp,
actual dispatch timestamp, dispatch delay caused by a blocked main thread,
final-keystroke-to-final-paint processing latency, and
first-keystroke-to-final-paint UX duration. Do not subtract synchronous
grid execution inside `setText` from processing latency. The next prefix is
issued at its scheduled time even if earlier work is still pending. After
the final character the driver waits for accepted `"Patel"`, pending=false
where applicable, the correct displayed-row count, and two animation
frames. Record accepted-query events, pending transitions,
superseded/cancelled prefixes where genuinely observable, longest
main-thread task, long tasks over 50 ms, and animation-frame gaps. Input
acceptance is not a completed search result. The intentional 120 ms
intervals are not grid-processing latency.

**Settled incremental (diagnostic).** Each prefix settles before the next.
Record latency and row-count correctness per prefix. This is not the primary
real-user result.

LightFastGrid is measured in three explicitly named modes on both React and
Vanilla. Dataset, columns, queries, typing cadence, viewport, browser, and
CPU conditions stay identical; the only intentional difference between
`workerIsolated` and `mainThreadIsolated` is `execution.thresholds.quickSearch`.

| Mode | Public configuration | Gate |
| --- | --- | --- |
| `workerIsolated` | cache/prewarm false, threshold 25,000, 100,000 rows | Direct completion producer must be `"worker"`. Pending, eligibility, Worker URL, and Worker creation are not proof. |
| `mainThreadIsolated` (`forcedMainThread`) | cache/prewarm false, threshold `ROW_COUNT + 1` | Direct completion producer must be `"mainThread"`. Reject `"worker"` or `"cache"`. Pending may still occur as deferred main-thread fallback and is not a Worker route. Not the default configuration. Not a competitor. |
| `workerProductionOptimized` | cache/prewarm true, threshold 25,000 | Separate sample completion from Worker-performance claims. `"unknown"` is invalid. Below the Worker threshold, `"mainThread"` is expected and valid. At or above the threshold, `"worker"` is Worker evidence; `"cache"` is a valid cache/prewarm result and must not be labeled Worker execution; `"mainThread"` is retained as product performance and makes Worker-specific comparison provisional/non-publishable. Identical React and Vanilla rules. |

AG Grid has no LightFastGrid-style Quick Search Worker. Run one optimized AG
Grid baseline per framework with `cacheQuickFilter: true`. Do not re-execute
AG Grid for every LightFastGrid mode. Reuse a valid AG sample only when the
scenario identity matches. Never use a repeated-query AG sample as the
cold-typing result.

Report these comparisons with no winner field:

- LFG Worker isolated vs LFG forced main thread
- LFG Worker isolated vs AG Grid
- LFG production optimized vs AG Grid

Worker execution is not automatically a lower completion-time result. It
primarily protects main-thread responsiveness. Report settlement latency and
responsiveness side by side. Do not claim a Worker win because the longest
main-thread task is smaller. Do not claim a latency win unless the measured
completion result is also lower. Preserve unfavorable results. Explain whether
an advantage came from Worker execution, cache reuse, prewarming, cancellation
of stale prefixes, or a combination.

`summary.quickSearchModeComparison` holds separate React and Vanilla tables
for cold full query, cold realistic typing, primed different query, repeated
same-query cache, settled incremental diagnostic, and responsiveness. Each
cell retains scenario identity, mode identity, valid sample count, median,
eligible p95, UX duration where relevant, producer distribution, Worker
throttle proof, correctness state, and provisional reasons. Primary
`applications.lightfastgrid` statistics use `workerIsolated` samples so the
three LightFastGrid identities are not mixed into one product bucket.

Producer proof is a benchmark-only wrap of the live instance's private
`execution.scheduleQuickSearch` completion, which already labels
`producer: "cache" | "mainThread" | "worker"`. That field is not a public
Grid API. The wrap does not change scheduling, eligibility, cache, or
Worker algorithms. Never derive `workerRouteConfirmed` from pending state
or row-count eligibility.

Before publishing Worker-vs-main-thread numbers, prove equal compute for every
competitor on that profile.

**4× diagnostic (`publish`).** Apply page `Emulation.setCPUThrottlingRate` at 4
via `browserContext.newCDPSession(page)` before timed work. Attempt nested
Worker `Emulation.setCPUThrottlingRate` and require acknowledgement. Chromium
currently reports that operation is only supported for pages, not workers.
That nested protocol error is an acknowledgement **failure**, not confirmation.
A 4× page-throttled run with an unthrottled Worker is unequal compute: keep the
raw results, mark Worker-vs-main-thread comparisons provisional/non-publishable,
and do not display them as a public competitive claim. Do not hide, reinterpret,
or fake Worker throttle success. Do not invent an OS or container throttle.

**Native 1× publication (`publish-native`).** Same 100,000 × 50 public-candidate
schedule, machine, browser, and environment for every competitor. Do **not**
send `Emulation.setCPUThrottlingRate` to the page or any Worker. Equal compute
is native 1× speed. Record the profile and the absence of CDP throttle
explicitly. React and Vanilla remain separate lanes. A native 1× run does not
prove 4× throttled performance.

Sending `Target.sendMessageToTarget` is not 4× acknowledgement. Subscribe to
`Target.receivedMessageFromTarget` before sending, match target/session and
nested command ID, and parse a successful inner `result`. Do not treat a sent
command or Worker URL as success. Collision-safe monotonic command IDs are
required; `Date.now()` alone is not. Track target/session identity separately
from URL. Do not set `confirmedEquivalentToPage: true` because a URL was added
to an array. Do not use `results.some(...)` as run-level 4× proof. Forced
main-thread and AG Grid slots do not require a Worker target; 4×
Worker-enabled LightFastGrid samples (`workerIsolated`,
`workerProductionOptimized`) do. Native 1× slots require no Worker CDP
throttle and record equal compute as native-unthrottled. Smoke at 10,000 rows
remains below the 25,000-row Worker threshold and is not Worker performance
evidence; `workerIsolated` samples there are invalid when the producer is
not `"worker"`.

## 7. Ownership and Dependency Boundaries

### 7.1 Feature owner

`benchmarks/` owns the harness. Core Worker URL emission is a packaging
contract: hashed Worker files under `dist/assets` are addressed with URLs
relative to the emitting chunk. ESM uses `import.meta.url`. CJS uses
`require("url").pathToFileURL(__dirname+"/").href`. Neither format uses
site-root `/assets/` or invalid `{}.url` / `"undefined"` bases. Worker
algorithms, eligibility, and public APIs are unmodified. Packed tarballs are
not rewritten after `pnpm pack`; benchmark workspace overrides deliberately
resolve Core and React to the local packed tarballs so a registry install
cannot be used accidentally. Named Quick Search
modes configure public `quickFilter` and `execution.thresholds.quickSearch`
options in the benchmark apps only.

### 7.2 Neutral shared services

`benchmarks/shared` owns scenarios, columns, value pools, row generation,
protocol types, viewport constants, completion helpers, host styles, and a
framework-neutral Vanilla DOM chrome. It must not import `@lightfastgrid/*`
or `ag-grid-*`. The default export includes React shell components for React
apps. Vanilla apps must import `@lfg-benchmarks/shared/neutral` (runtime) or
`@lfg-benchmarks/shared/bundle` (bundle mode) so React is not pulled into
their production bundles. `@lfg-benchmarks/shared/bundle` must not re-export
protocol, completion, or instrumentation modules.

### 7.3 Dependency direction

```text
root scripts -> benchmarks/scripts
benchmarks/apps/lightfastgrid -> file: artifacts tarballs + shared
benchmarks/apps/ag-grid -> ag-grid-react@36.1.0 + shared
benchmarks/apps/react-baseline -> react + shared
benchmarks/apps/lightfastgrid-vanilla -> file: Core tarball + shared/neutral or shared/bundle
benchmarks/apps/ag-grid-vanilla -> ag-grid-community@36.1.0 + shared/neutral or shared/bundle
benchmarks/apps/vanilla-baseline -> shared/neutral or shared/bundle only
shared/bundle -> schema, fixture, column mapping, vanilla chrome; no protocol
shared/neutral -> JSON config and DOM helpers; no React
shared (default) -> React shell components for the React lane
```

### 7.4 Forbidden dependencies

- LightFastGrid workspace source or `workspace:*` from the root monorepo
- Vite aliases from Vanilla apps to `packages/core`
- React or ReactDOM in any Vanilla app
- AG Grid Enterprise
- TanStack
- Playground or other application imports of benchmark apps
- Mixing React-lane and Vanilla-lane totals or estimates
- Counting dataset JSON as grid library bytes (compact config is shared app
  code; generated rows are runtime-only)

### 7.5 Public integration seam

`window.__GRID_BENCHMARK__`. Each app implements the same method names.

## 8. Data and State Model

Rows are generated in memory from `scenarios.json`, `columns.json`, and
`value-pools.json` plus a seeded PRNG. They are not snapshotted to disk.

Row identity is `id = row-${paddedIndex}` (7-digit, 1-based). The same seed,
index, and column set must produce the same values in every app and in Node
verification.

## 9. Processing Pipeline

```text
prepare packages -> pack tarballs -> isolated pnpm install
  -> verify realpath/version boundary
  -> Vite production build per app: dist/bundle and dist/runtime
  -> measure dist/bundle with zlib gzip/brotli
  -> static preview HTTP check (does not execute the app)
  -> Playwright Chromium orchestrator drives one dist/runtime app at a time
     with deterministic AB/BA interleaving per lane
```

Data generation is a caller-visible prelude, not part of grid init.

## 10. State Machines and Commit Points

Protocol calls are serialized. Destroy is terminal for the current mount.
A later `prepareScenario` + `mount` starts a new generation.

Not applicable: Core Worker protocol. The harness does not own grid Workers.

## 11. Performance Contract

### 11.1 Units and thresholds

Bundle sizes are bytes on disk and zlib-compressed bytes. Runtime primary
metrics are protocol-settlement milliseconds. Optional Chromium observers
(long tasks, rAF gaps, heap) are secondary and must declare support. rAF
gaps over 20ms are scheduling delays, not dropped frames.

### 11.2 Complexity

| Operation | Caller-stack work | Notes |
| --- | --- | --- |
| Row generation | O(rows × columns) | Timed as `generationMs` |
| Checksum | O(rows × columns) | Node verification only; extreme skipped by default |
| Bundle measure | O(emitted files) | No `.map`, no generated datasets |

### 11.3 Cooperative scheduling

Browser protocol operations await the completion boundary. Node generation
for default checksums may allocate the full in-memory table; extreme is
opt-in because 200,000 × 100 is memory-intensive.

### 11.4–11.6 Allocation, retained memory, backpressure

Default verification retains at most one generated table at a time.
`prepareScenario` releases the previous table before generating the next.
Extreme is documented as memory-intensive. No production grid caches are
added.

### 11.7 Performance claims

Public docs and the README may describe methodology only. They must not
publish ranking numbers until repeated controlled runs exist. V1 records
bundle measurements locally from `dist/bundle` and does not commit them as
product claims. If the worktree is dirty, recorded figures are provisional.
The publish command still succeeds in that case; it fails only when required
4× CDP throttling cannot be applied or a product lacks the required number of
valid measured samples.
React and Vanilla percentages must never be combined.

## 12. Worker and Protocol

LightFastGrid’s existing execution Workers remain the product default. Packed
Core must ship sort, filter, quick-search, and CSV Worker files. ESM
constructors use `new URL("./assets/*Worker-*.js", import.meta.url)` so a
consumer Vite build emits Worker JS. CJS constructors use
`new URL("./assets/*Worker-*.js", require("url").pathToFileURL(__dirname+"/").href)`
and are evaluated in Node as `file:` URLs. Bundle measurement fails if any
referenced LightFastGrid Worker URL does not resolve to an emitted file, or
if sort, filter, and quick-search Workers are missing (CSV may tree-shake
when unused). The same consumer Worker check applies to both the React and
Vanilla LightFastGrid production builds. `getMeta().gridVersion` is the exact
packed package version for that app (`@lightfastgrid/react` or
`@lightfastgrid/core`), not a placeholder.

Named runtime modes pass public threshold, cache, and prewarm options. They
do not patch Worker algorithms. `workerIsolated` requires direct completion
producer `"worker"`. `forcedMainThread` requires producer `"mainThread"`.
Production mode separates sample completion from Worker-performance claims.
4× `publish` Worker-vs-main-thread tables additionally require acknowledged
equivalent CPU throttling of every contributing Quick Search Worker
target/session; Chromium's Worker-target limitation keeps those tables
provisional. Native 1× `publish-native` is the fair equal-compute profile
for publishable Worker comparisons and must not claim 4× proof.

## 13. Cache and Coherence

No result cache of timings. Each `prepareScenario` releases the previous
generated table, then regenerates rows. LightFastGrid `workerProductionOptimized`
enables the product Quick Search cache and prewarm; those effects are measured
as separate primed-different and repeated-same operations and must not be mixed into cold latency.

## 14. Cancellation, Replacement, and Failure

Destroy unmounts the current host (React root or Vanilla DOM chrome) and
clears protocol grid handles. Prepare scripts fail loudly on build or pack
errors. Extreme without opt-in fails before generation.

## 15. Security and Data Safety

Synthetic data only. No user PII. Tarballs stay local and gitignored.

## 16. Alternatives Considered

| Alternative | Why not selected |
| --- | --- |
| Root-workspace `workspace:*` LightFastGrid app | Would measure source links, not packed consumer install |
| AG Grid Enterprise | Paid; out of comparison scope |
| Tree-shaken AG Grid modules | Less comparable to LightFastGrid’s integrated MIT package; V1 uses documented `AllCommunityModule` |
| Committed 200k×100 JSON | Repository bloat; generation is deterministic |
| TanStack in V1 | Explicitly deferred |
| Mixing React and Vanilla into one ranking | Different framework overhead; invalid comparison |
| React Profiler as primary metric | Misses Worker, layout, and paint work |

## 17. Test Matrix

1. Prepare builds Core and React and writes stable tarball filenames.
2. Packed React depends on the exact packed Core version (not `workspace:*`).
3. After isolated install, `@lightfastgrid/core` and `@lightfastgrid/react`
   realpaths in the React app are not under `packages/`. The Vanilla Core
   realpath is also not under `packages/`.
4. Default scenario list excludes `extreme`.
5. `prepareScenario("extreme")` without opt-in throws and does not generate.
6. Default scenarios produce stable SHA-256 checksums across two runs.
7. All six apps production-build **bundle** and **runtime** modes with
   identical Vite settings into `dist/bundle` and `dist/runtime`. Static
   preview verification fetches HTML/JS over Vite Preview; it does not
   execute the grid or protocol.
8. Bundle script measures **`dist/bundle` only**, reports
   `methodology.buildMode: "bundle"`, raw/gzip/brotli JS and CSS, initial vs
   lazy/worker JS, totals, and file counts in two lanes; each matching
   baseline is separate; incremental estimate is labeled, nested under
   `lanes.<lane>`, and never crosses lanes. There is no top-level
   React-only `incrementalGridEstimate`. Every LightFastGrid Worker URL in
   both LightFastGrid bundle (and runtime) dists resolves to an emitted
   file; sort/filter/quickSearch Workers are present.
9. Packed Core tarball and installed package contain hashed Worker files;
   ESM uses `import.meta.url`; CJS uses `pathToFileURL(__dirname)`; neither
   uses `/assets/` or `{}.url`. Packed tarballs are byte-for-byte unchanged
   from pack through install. Two consecutive `benchmark:prepare` runs succeed.
10. All six apps typecheck (`tsc --noEmit`) during verify and before Vite
    production builds.
11. `getMeta().gridVersion` is the exact packed package version for that app
    (`@lightfastgrid/react` or `@lightfastgrid/core`).
12. `git diff --check` is clean for harness files.
13. Vanilla apps declare neither React nor ReactDOM; bundle module
    inventories contain no `react`, `react-dom`, `react/jsx-runtime`, or
    `@lightfastgrid/react`; a string-marker scan is secondary; sources import
    `shared/neutral` or `shared/bundle`.
14. AG Grid Vanilla locks `ag-grid-community@36.1.0`, uses `createGrid` and
    `AllCommunityModule`, and does not depend on `ag-grid-react` or Enterprise.
15. Vanilla baseline has no LightFastGrid or AG Grid dependency.
16. Incremental estimates set `isEstimate: true` and name the matching
    framework baseline. React and Vanilla percentages must never be combined.
17. Bundle entries do not import protocol/driver modules and do not emit
    `__GRID_BENCHMARK__`. Runtime entries still install the protocol.
18. After Quick Search, LightFastGrid `displayedRowCount` is the processed
    displayed-row count (not `getRows().length` and not a timed aria-rowcount
    wait), read after pending=false (when observed) and two animation frames;
    clearing search uses the same settlement; React and Vanilla stay equivalent.
    Inspection does not mutate loading or overlays.
19. Event waits use `waitForGridEvent` / `waitWithTimeout` with listener
    cleanup on success, timeout, thrown command, and teardown.
20. Playwright is Chromium-only, `workers: 1`, `fullyParallel: false`, and a
    single orchestrator spec. It must not use four independently grouped
    projects that regroup all samples from one product.
21. Smoke is `normal` 10,000 × 20 with 1 warmup and 1 measured round.
    4× `publish` and native 1× `publish-native` are `runtime-publish`
    100,000 × 50 with 3 warmups and at least 10 measured rounds. 10,000 rows
    is below the 25,000-row Worker threshold and is not Worker performance
    evidence.
22. 4× `publish` applies `Emulation.setCPUThrottlingRate` at 4 via
    `browserContext.newCDPSession(page)` before timed work and fails if page
    4× throttling cannot be applied. Nested Worker throttle acknowledgement
    remains required for 4× Worker-vs-main-thread claims; Chromium currently
    does not support that operation on Worker targets, so those claims stay
    provisional/non-publishable. Native 1× `publish-native` sends no CDP CPU
    throttle to page or Worker. Smoke may record unsupported CDP and must not
    be treated as publishable.
23. Each lane uses a deterministic AB/BA schedule. Competitive slots measure
    one canonical LightFastGrid product-default identity and AG Grid for
    Mount/Sort/Filter/Reset/Scroll. Quick Search slots then measure LFG
    `workerIsolated`, `mainThreadIsolated` / forced main thread, and
    `workerProductionOptimized`, plus AG Grid, for Quick Search only. Odd
    rounds reverse the full list. AG Grid is measured once per equivalent
    scenario per round. Ordinary operations are never pooled from Quick
    Search modes.
    AG Grid runs once per round and is reused for Worker-vs-AG and
    production-vs-AG tables. Forced main thread is not a competitor. Warmups
    are labeled and excluded from published statistics. React and Vanilla stay
    separate. Seed `20260906`.
24. Measured samples are accepted only after exact displayed counts, accepted
    sort/filter/search models, and scroll settlement with a documented
    `scrollTop` tolerance. Invalid samples are recorded with structured
    reasons and never enter latency statistics. Unrecorded setup resets are
    inspected; failures use `invalid-setup-state`. `workerIsolated` Quick
    Search samples without confirmed Worker route use `worker-route-unconfirmed`.
    Forced main thread samples that used a Worker use `unexpected-worker-route`.
25. Long-task, rAF-gap, and heap observers report `{ supported: true, ... }`
    or `{ supported: false, reason }`. Unsupported observers must not appear
    as valid zeros. rAF gaps are not called dropped frames. Long tasks over
    50 ms are recorded as `over50msCount`.
26. Each run writes a unique gitignored `results/runtime/<run-id>/` directory
    (`summary.json`, `raw-samples.json`, `environment.json`,
    `methodology.json`, `errors.json`, `schedule.json`). Harness failures
    still write partial evidence with `complete: false`. When a primary
    harness failure exists, `fatalReason` is `harness <phase>: <message>`
    and missing-sample reasons stay secondary. Context/page/preview/guard
    acquisition is inside cleanup/evidence boundaries; cleanup is
    independent. `orchestrator-complete.json` is written after final
    publication state and is never `ok: true` after evidence-write or
    teardown failure. The final merged summary is schema-validated after
    environment/provisional fields are merged. No winner field.
    `p95SampleCountEligible` is sample-count-only; `publishable` is
    report-level publication permission. Promotion of lab evidence into
    public pages is a later explicit boundary.
27. Typing burst uses prefixes `P → Pa → Pat → Pate → Patel` at 120 ms
    without awaiting intermediate settlement. Capture the actual dispatch
    timestamp immediately before `setText`. Processing `durationMs` is
    final keystroke → final paint and includes synchronous grid work inside
    `setText`. Cadence waits are recorded and excluded from grid-processing
    latency. After the final character the driver uses accepted events,
    pending=false where applicable, displayed-row correctness, and two
    frames — not an arbitrary sleep. Stale earlier results that replace
    `"Patel"` invalidate the sample.
28. Settled incremental typing records latency and displayed-row count for
    every prefix, runs on a fresh instance, and is diagnostic only.
29. LightFastGrid React and Vanilla each expose `workerIsolated`,
    `forcedMainThread`, and `workerProductionOptimized`. The first two differ
    only by `execution.thresholds.quickSearch`. Production cache/prewarm is
    timed separately from cold queries. Direct `scheduleQuickSearch`
    completion producer is the only Worker-route proof.
30. AG Grid React and Vanilla use one optimized baseline with
    `cacheQuickFilter: true`. Reuse a valid AG sample only for the same
    scenario identity. Never use a repeated-query AG sample as cold typing.
31. Equivalent compute must be confirmed before Worker-vs-main-thread
    numbers are public. For 4× `publish`, that means page 4× plus acknowledged
    nested Worker `Emulation.setCPUThrottlingRate`. Missing Worker proof keeps
    raw results and marks the comparison provisional/non-publishable. Native
    1× `publish-native` records no CDP throttle on page or Worker and does not
    prove 4× performance.
32. `summary.quickSearchModeComparison` contains React and Vanilla tables
    for cold full query, cold realistic typing, primed different query,
    repeated same-query cache, settled incremental diagnostic, and
    responsiveness. No winner. Forced main thread is not a competitor.
33. Cold realistic typing never inherits a prior `"Patel"` query or Quick
    Search cache on the same grid instance.
34. `workerRouteConfirmed` is never derived from pending state or
    row-count eligibility.
35. Worker throttle confirmation is nested CDP acknowledgement, not URL
    presence or `results.some(...)`.
36. Publication is rejected when any Worker-isolated measured sample lacks
    producer `"worker"`, any forced-main-thread sample reports a producer
    other than `"mainThread"`, equal compute is unconfirmed for the profile's
    Worker comparison, scenario identity is missing, correctness/sample-count
    requirements fail, or `quickSearchModeComparison.provisional` is true.
    Comparison-level reasons are calculated once and fed into
    `resolveRunPublication` before `publishable` is resolved.
37. Production producer interpretation is identical for React and Vanilla:
    `"unknown"` is invalid; below the Worker threshold `"mainThread"` is a
    valid diagnostic sample; at or above the threshold `"worker"` is Worker
    evidence, `"cache"` is cache/prewarm only, and `"mainThread"` is retained
    but makes Worker-specific comparison provisional.
38. Every required public-candidate warmup slot must complete successfully.
    One bounded retry uses a fresh page/grid slot. A successful retry may
    recover only the matching first-attempt warmup failure, identified by
    lane, appId, lfgMode, round, slotIndex, and warmup attempt 0. It must
    not recover another lane, application, mode, round, retry-attempt,
    measured-slot, or secondary teardown failure. Retry exhaustion retains
    both failures, marks the run incomplete/non-publishable, and never lets a
    measured sample replace the warmup. Secondary teardown does not replace
    the warmup failure. Smoke remains diagnostic and never publishable.
39. Schema validation rejects `publishable: true` together with
    `quickSearchModeComparison.provisional: true`. There is no winner field.
40. Native 1× evidence records that CDP CPU throttling was not applied. A
    native run may be publishable only when every other publication rule
    passes. A 4× page with an unthrottled Worker cannot be a public
    Worker-vs-main-thread claim.
41. Runtime Playwright preview is a directly owned Vite Node process. Stop
    waits for confirmed process exit after SIGTERM and a SIGKILL fallback.
    Startup failure and interruption must not leak preview processes.
42. Warmup recovery uses the complete slot identity. Slot index alone is not
    enough because React and Vanilla both restart indexes at 0.
43. SIGINT and SIGTERM await owned-process cleanup, then terminate the
    harness (130 / 143). Cleanup runs once. A second signal force-exits.
    `beforeExit` does not await async stop or re-enter forever.
44. Preview HTTP-readiness failure remains the primary error. An additional
    owned-process stop failure is preserved beside it, not swallowed.
45. AG Grid React remount readiness is the current mount generation's living
    GridApi, expected displayed-row count, and rows or empty overlay inside
    that API's `getGridElement()`. The host is captured with a GridHost
    callback ref, not `hostRef.current` inside `onGridReady` (that callback
    can run before the parent ref is attached). Destroy waits until
    `.ag-root-wrapper` is gone from the benchmark host before the next
    mount. `firstDataRendered` is not a reliable repeated-remount signal
    and must not be the sole waiter. A stale or destroyed grid cannot
    satisfy a newer generation. Smoke may keep below-threshold
    `workerIsolated` `worker-route-unconfirmed` samples as diagnostics. Any
    other invalid measured sample makes the run incomplete and fails smoke
    verification after evidence is written.
46. Canonical public runtime scenario is `runtime-publish` at 100,000 rows ×
    50 columns with the existing seed. Public-candidate profiles cannot run
    any other scenario. Dataset SHA-256 and column-schema SHA-256 are locked.
47. Shared filter protocol is a neutral AND model (text contains, numeric
    inclusive between). Products translate it to public APIs only. Simple
    `filter(field, value)` routes through that model. Accepted state includes
    operators and values, not only field names.
48. Isolated filter scenarios remount a fresh grid: text apply/clear, numeric
    range apply/clear, combined AND apply/clear, and typed `name contains
    Patel` at 120 ms. Cadence waits are not grid time. Final-keystroke-to-
    final-paint is the primary typing metric.
49. `computeExpectedOperations()` is the independent oracle. A displayed-row
    or accepted-model mismatch invalidates the sample, stays in raw evidence,
    is excluded from latency statistics, and blocks publication.
50. Filter operations have distinct identities (`filterTextApply`,
    `filterTextClear`, `filterNumberRangeApply`, `filterNumberRangeClear`,
    `filterCombinedApply`, `filterCombinedClear`, `filterTypingBurst`). The
    Public summaries may group them under Filter; raw evidence keeps each identity.
51. Ordinary competitive operations use one canonical LightFastGrid identity
    (product default). Quick Search mode slots record only Quick Search.
    AG Grid is measured once per equivalent scenario per round. Samples are
    never reused under another identity or pooled across QS modes.
52. Filter completion producer is read from `scheduleFilter` like Quick Search.
    Sort uses the same scheduler probe when Core actually calls `scheduleSort`.
    Below the product sort threshold Core sorts without `scheduleSort`; unknown
    sort producer is a documented observation limit, not a Worker claim, and is
    left for a separate product-change review if public sort Worker proof is
    required. `unknown` is invalid for a LightFastGrid Filter Worker claim.
    AG Grid evidence states that this harness observes public completion and
    does not invent a Worker producer. Cache hits are never labeled Worker.
53. Native 1× remains the public Worker-comparison candidate. 4× remains a
    page/main-thread diagnostic. The same policy applies to Filter.
54. Promoted Benchmark v1 runtime artifacts include summary, raw samples,
    expected state, methodology, environment, errors, schedule, CPU evidence,
    package versions, tarball SHA-256, dataset and schema hashes, browser and
    Playwright versions, git commit and cleanliness, bundle-size reference,
    reproduction commands, a standalone verifier, and a SHA-256 manifest.
    Traces are diagnostic. The downloadable archive is created only at
    promotion, not during ordinary smoke.
55. Promotion requires `publish-native`, `publishable === true`,
    `complete === true`, clean committed worktree, canonical 100,000 × 50,
    required warmups, required measured counts, no unexpected invalids,
    non-provisional Quick Search and Filter comparisons, complete producer
    evidence, matching correctness counts, complete environment/hashes,
    schema verification, and no winner field. Public pages consume only that
    promoted artifact. Local fixtures require an explicit development flag.
    Production presentation must reject fixtures, smoke, dirty, and
    `publishable: false` reports.
56. Public runtime documentation reads only a promoted generated manifest.
    Missing promotion shows “Verified benchmark results are being prepared,”
    never smoke values. Tabs are Mount, Sort, Filter, Quick Search, Reset,
    and Scroll. Filter has text / numeric / combined / typing and apply/clear
    controls. Lanes stay separate. No fastest/best/winner badge. 4× is labeled
    diagnostic when Worker compute is unequal.

Required-test count: 56 focused checks (not the repo-wide suite).

## 18. Implementation Stages

V1 is a single isolated harness stage covering the workspace, apps, scripts,
and documentation listed in the owner request.

**Non-goals of this stage:** Published ranking numbers, TanStack, Core/React
algorithm changes, Firefox/WebKit.

**Exit criteria:** The fifty-six focused checks pass. Phase 1 Playwright writes
lane-separated smoke evidence from `dist/runtime` protocol calls. The final
100,000 × 50 public measurement is a later clean-worktree run.

## 19. Playground and Examples

Not applicable. This is not a playground feature.

## 20. Public Documentation Plan

`benchmarks/README.md` is the operator guide. Public runtime documentation
reads only a promoted generated manifest. Until promotion it shows that verified
results are being prepared. Smoke figures are never shown there.

## 21. Profiling and Benchmark Plan

Status: Required for bundle measurement and Phase 1 Chromium runtime
protocol timing. Public ranking/winner badges remain out of scope.

Phase 1 ships a Chromium orchestrator around `window.__GRID_BENCHMARK__`.

Smoke (diagnostic): 10,000 × 20, 1 discarded warmup round, 1 measured round,
exact correctness checks. Not Worker evidence. CPU throttle is requested at
4×; if CDP cannot apply it, the run records the failure and is not
publishable.

4× publish (public-candidate diagnostic for throttled main-thread/UX):
100,000 × 50, 3 discarded warmup rounds, at least 10 measured rounds (20
preferred via `LFG_BENCH_PUBLISH_ITERATIONS`). 4× CDP CPU throttling of the
page is required before timed work. Worker nested throttle remains
unsupported in Chromium; Worker-vs-main-thread numbers stay provisional and
the report is not publishable for those claims. Invalid samples never enter
latency statistics. A product that lacks the required valid measured count
fails the publish run. Required warmups must succeed or the run is incomplete.

Native 1× publish (`publish-native`, public-candidate for Worker comparisons):
the same 100,000-row schedule, machine, browser, and environment, with no CDP
CPU throttling on page or Worker. This is the fair equal-compute profile for
publishable Worker comparisons. It does not prove 4× throttled performance.

Each lane interleaves competitive product-default identities and Quick Search
mode identities with deterministic AB/BA rounds so Playwright project order cannot
regroup all samples from one product. Only one application is served at a
time. Forced main thread is not ranked as a competitor.

Evidence is written to `benchmarks/results/runtime/<run-id>/`.
`summary.quickSearchModeComparison` is the Worker-vs-main-thread and
LFG-vs-AG report. Promotion of lab evidence into public pages is a later
explicit boundary and is not
part of this stage. Trace mode captures one identified measured iteration
and is excluded from published timings. `p95SampleCountEligible` records P95
sample-count eligibility only; `publishable` is the only
publication-permission flag. Worker comparisons additionally require
confirmed equal compute for the selected profile (4× Worker CDP
acknowledgement, or native 1× with no CDP throttle). Comparison-level
provisional reasons block `publishable`.

`prepareScenario` generation is recorded separately. React Profiler remains
supplementary and off by default.

## 22. Acceptance Gate

- [x] Architecture recorded
- [ ] Focused checks 1–20 pass
- [ ] No Core/React runtime algorithm edits
- [ ] Packed Core Worker URLs are package-relative
- [ ] No npm publish
- [ ] No fabricated results committed
- [ ] Unrelated work (including Firefox pinned-column work) left untouched

## 23. Decision Log

| Date | Decision | Evidence/reason | Sections affected |
| --- | --- | --- | --- |
| 2026-09-06 | Isolated nested pnpm workspace under `benchmarks/` (not in the root workspace glob) | Prevent root `workspace:*` leaks; LightFastGrid still uses `file:` tarballs | 7, 9 |
| 2026-09-06 | `AllCommunityModule` + Theming API `themeQuartz` | Documented Community quick start | 1, 5 |
| 2026-09-06 | Extreme opt-in only | 200k×100 is memory-intensive | 5, 11 |
| 2026-09-06 | Status/category filters use text/equals, not AG Grid Set Filter | Set Filter is Enterprise | 5, 16 |
| 2026-09-06 | Packed Core Worker URLs are relative to the emitting chunk | Site-root `/assets/` omitted Worker chunks from consumer Vite builds | 4, 7, 12, 17 |
| 2026-09-06 | `mount()` includes `waitUntilReady()` for both grids | Comparable mount-to-ready timing | 6 |
| 2026-09-06 | `prepareScenario` releases the previous row array first | Reduce peak memory across large scenarios | 6, 11, 13 |
| 2026-09-06 | `gridVersion` is the exact packed React version | `packed-local` is not a publishable identifier | 12 |
| 2026-09-06 | Packed tarballs are never rewritten; local packed artifacts are mapped by `pnpm-workspace.yaml` overrides | `pnpm pack` already writes the exact Core version; mutating the tarball broke consecutive installs; overrides keep the harness on local tarballs instead of a registry install | 7, 9, 17 |
| 2026-09-06 | CJS Worker URLs use `pathToFileURL(__dirname)` | `{}.url` is not a valid URL base | 7, 12 |
| 2026-09-06 | `clearOperations` inspects state, awaits accepted resets, skips no-ops | Empty models do not emit; hanging waits are invalid | 6 |
| 2026-09-06 | Independent React and Vanilla comparison lanes | Framework overhead is not interchangeable; do not mix totals or estimates | 1, 3, 7, 17 |
| 2026-09-06 | Vanilla apps import `@lfg-benchmarks/shared/neutral` | Default shared entry exports React components | 7 |
| 2026-09-06 | AG Grid Vanilla uses `createGrid` + `AllCommunityModule` at 36.1.0 | Same Community surface as the React lane, without React | 1, 5 |
| 2026-09-06 | Bundle vs runtime Vite modes (`dist/bundle`, `dist/runtime`) | Public size figures must not include protocol instrumentation | 3, 9, 17 |
| 2026-09-06 | Shared `waitForGridEvent` always unsubscribes | Timeouts must not leave grid listeners attached | 6 |
| 2026-09-06 | Static preview verification is HTTP-only | It does not prove the grid mounted or the protocol ran | 17 |
| 2026-09-07 | Phase 1 Playwright is Chromium, one worker, four grid apps, `normal` scenario | Runtime protocol timing must not mix lanes or compete for the same CPU | 9, 17, 21 |
| 2026-09-07 | AG Grid scroll uses `.ag-grid-viewport` | AG Grid 36 Theming API no longer emits `.ag-body-viewport` | 6 |
| 2026-09-07 | Smoke vs publish runtime profiles; 10k is not Worker evidence | 25,000-row sort/filter/QS Worker threshold; publish uses 100k with required 4× CDP throttle | 3, 11, 17, 21 |
| 2026-09-07 | Deterministic AB/BA interleaving per lane | Avoid grouping all samples from one product; keep one app loaded at a time | 9, 17, 21 |
| 2026-09-07 | Invalid samples recorded, never mixed into latency stats | Exact counts, accepted models, and scroll settlement are gates | 17, 21 |
| 2026-09-07 | Optional observers declare `supported` | Unsupported instrumentation must not appear as a valid zero | 11, 17 |
| 2026-09-07 | Quick Search timing ends at pending=false plus two frames; displayed count is a non-mutating processed-row inspection | A 2.5s aria-rowcount wait and `setLoading` resync were contaminating latency and correctness | 5, 6, 17 |
| 2026-09-07 | Unrecorded setup resets are validated or they invalidate the next operation | Contaminated Filter/Quick Search samples must not enter statistics | 6, 17 |
| 2026-09-07 | Harness failures write partial evidence with `complete: false` | Preview/navigation/protocol/throttle/prepare aborts were leaving empty run directories | 5, 17, 21 |
| 2026-09-07 | `p95SampleCountEligible` is sample-count-only; `publishable` is report-level | Dirty publish reports must not claim figures are publicly publishable | 17, 21 |
| 2026-09-07 | Root primary harness failure is `fatalReason`; missing-sample reasons stay secondary | Incomplete runs were reporting sample-count fatals while the harness had already timed out | 6, 17 |
| 2026-09-07 | Context/page/preview/guard acquisition is nullable-owned with independent cleanup | Acquisition failures could leak previews or skip partial evidence | 6, 17 |
| 2026-09-07 | Realistic typing burst plus named LFG Worker/main-thread/production modes | Submitting `"Patel"` in one call is not interactive UX; Worker vs forced main thread must isolate threshold only; AG Grid is one optimized baseline | 3, 5, 6, 12, 13, 17, 21 |
| 2026-09-07 | Burst dispatch timestamps are captured before `setText` | Synchronous forced-main-thread search inside `setText` was excluded from final-keystroke latency | 6, 17 |
| 2026-09-07 | Direct `scheduleQuickSearch` completion producer is the only Worker-route proof | Pending and row-count eligibility can represent deferred main-thread fallback | 6, 12, 17 |
| 2026-09-07 | Nested CDP acknowledgement is required for Worker CPU throttle proof | Sending `Target.sendMessageToTarget` or recording a Worker URL is not acknowledgement; aggregation cannot use `some()` | 6, 12, 17 |
| 2026-09-07 | Isolated cold, primed, repeated, and typing Quick Search scenarios on fresh instances | Typing after a prior `"Patel"` inherited caches; one warm operation mixed different-query warmth and same-query cache | 6, 13, 17 |
| 2026-09-07 | Comparison-level Quick Search reasons feed `resolveRunPublication` before `publishable` is set | `collectQuickSearchComparisonReasons` existed but did not block publication; `publishable: true` with a provisional comparison is invalid | 6, 17, 21 |
| 2026-09-07 | Production producer matrix separates completed samples from Worker-performance claims | Honest main-thread fallback at/above threshold must be retained without being marketed as Worker execution; cache is never Worker | 6, 12, 17 |
| 2026-09-07 | Public-candidate warmups require success with one fresh-slot retry | Failed warmups were ignored when measured samples existed; measured must not replace warmup | 6, 17, 21 |
| 2026-09-07 | Native 1× profile is the fair publishable Worker equal-compute path; 4× stays diagnostic | Chromium rejects Worker `Emulation.setCPUThrottlingRate`; do not fake 4× Worker throttle or claim 1× proves 4× | 3, 6, 12, 17, 21 |
| 2026-09-07 | Runtime preview is a directly owned Vite Node process with confirmed-exit stop | `pnpm exec vite preview` left descendant Vite/pnpm orphans; SIGTERM of the wrapper was treated as success | 6, 17 |
| 2026-09-07 | Warmup recovery matches lane, app, mode, round, slot index, and first attempt | Slot indexes restart per lane, so index-only recovery could clear an unrelated failure | 6, 17 |
| 2026-09-07 | SIGINT/SIGTERM await owned-process stop then exit 130/143 | Installing listeners removed Node's default exit, so Ctrl+C left the harness alive | 6, 17 |
| 2026-09-07 | Preview startup and cleanup failures are both preserved | A failed `stop()` after failed readiness was caught and discarded | 6, 17 |
| 2026-09-07 | AG Grid React remount waits on generation + displayed rows + DOM | `onFirstDataRendered` can miss on a repeated React remount, hanging 30s | 6, 17 |
| 2026-09-07 | AG Grid React remount uses current `getGridElement()` and waits for prior teardown | `onGridReady` can run before the parent host ref is attached; one rAF after destroy left a live `.ag-root-wrapper` that blocked the next grid | 6, 17 |
| 2026-09-07 | Canonical public runtime workload is 100,000 × 50 with locked hashes | Public-candidate runs used 100,000 × 20, which is not the frozen public matrix | 5, 6, 17 |
| 2026-09-07 | Neutral filter protocol plus isolated apply/clear/typing scenarios | Shared protocol exposed only field names; one `filter` sample mixed scenarios and QS-mode copies | 5, 6, 13, 17 |
| 2026-09-07 | Canonical product identity for ordinary ops; QS modes are QS-only | Three LightFastGrid QS modes tripled Mount/Sort/Filter/Scroll weighting | 6, 17 |
| 2026-09-07 | Direct filter/sort producer probe and public evidence ingestion | Public pages had no verified runtime manifest path; Worker filter claims lacked scheduler proof | 6, 17, 21 |

## 24. Open Questions

Firefox and WebKit runtime lanes are deferred. Public timing publication
is deferred until repeated controlled Chromium runs exist.
