# LightFastGrid comparison benchmark harness

Isolated lab for two **independent** comparison lanes. Do not mix them.

**React lane**

1. `@lightfastgrid/react` installed from **locally packed npm tarballs**
2. **AG Grid React Community** `36.1.0` with `AllCommunityModule`
3. A **React-only baseline** used solely to understand shared React application overhead

**Vanilla lane**

1. `@lightfastgrid/core` installed from the **same locally packed Core tarball**
2. **AG Grid Community Vanilla** `36.1.0` with `createGrid` and `AllCommunityModule`
3. A **framework-free Vanilla baseline** used solely to understand shared Vanilla application overhead

Existing React application directories are unchanged (`lightfastgrid`, `ag-grid`, `react-baseline`). Vanilla apps are additional (`lightfastgrid-vanilla`, `ag-grid-vanilla`, `vanilla-baseline`).

This workspace is not part of the root pnpm workspace or playground. It never
publishes to npm. It does not change Core or React
runtime algorithms. Packed Core Worker URLs must be package-relative so a
Vite consumer emits Worker assets; that packaging contract is required
before any comparison numbers are publishable.

Architecture: `engineering/architectures/benchmarks/GRID_COMPARISON_BENCHMARK_V1_ARCHITECTURE.md`

## Comparison boundaries

| Included | Excluded |
| --- | --- |
| Production builds of six separate apps in two lanes | Rendering two grids at once |
| Identical deterministic data, viewport, row height, column widths | AG Grid Enterprise (paid) |
| Sort, filter, quick search, scroll protocol | Custom cell renderers, pagination, pinned columns |
| Production JS/CSS payload with gzip and Brotli | npm tarball size as a “bundle size” |
| Matching framework baseline per lane | Subtracting React overhead from Vanilla, or vice versa |
| Local `pnpm pack` install of LightFastGrid | Workspace `workspace:*` / source aliases |

React results and Vanilla results are **not** one comparison. A Vanilla app
does not include React, so subtracting the React baseline from it (or combining
the lanes into one percentage) is invalid.

AG Grid Community is used because it is MIT licensed and has documented React
and Vanilla quick starts. `AllCommunityModule` is the documented full Community
bundle and is a reasonable comparison with LightFastGrid’s integrated MIT
package. That configuration is recorded in `window.__GRID_BENCHMARK__.getMeta()`.

LightFastGrid is installed from tarballs so the measured consumer graph matches
a published package, not this repository’s workspace links.

Do not optimize one grid while leaving the other poorly configured. Do not
make “fastest” or “best” claims. Bundle size does not prove runtime speed.
Do not publish a result without repeated controlled runs.

AG Grid is a product of AG Grid Ltd. The Community package used here is MIT
licensed.

## What is and is not comparable

**Comparable (same scenario, same machine, same browser, repeated runs, same lane):**

- Production application JS/CSS payload from `dist/bundle` (primary result)
- Protocol operations after data generation (`mount`, `sort`, isolated
  filter identities, `typeQuickSearch` / `quickSearch`, `clearOperations`,
  `scrollTo`) in the same lane, same Chromium, same scenario, repeated runs

**Not comparable, or only as labeled estimates:**

- Incremental “grid-only” bytes (`grid app − matching framework baseline`) — an **estimate**
- React-lane estimate minus Vanilla-lane estimate, or any cross-lane percentage
- AG Grid Community main-thread sort/filter vs LightFastGrid Worker execution
  above product default thresholds — recorded as an unavoidable difference
- Theme CSS vs JS-injected Theming API (AG Grid 36 uses the Theming API; CSS
  bytes may be low while JS contains theme). Use **total production payload**
- Tarball file size
- Compact `benchmarks/shared/*.json` config (shared app data, not a grid library)
- Generated row arrays (runtime memory, not bundle bytes)

The `extreme` scenario (200,000 × 100) is **memory-intensive and opt-in**.
Automatic verification and default app load never generate it.

## Reproduce from a fresh checkout

Node `>=20` (this repo uses Node 22) and pnpm `10.33.2`.

From the repository root:

```bash
pnpm benchmark:prepare
pnpm benchmark:verify
pnpm benchmark:build
pnpm benchmark:bundle-sizes
node benchmarks/scripts/capture-environment.mjs
pnpm benchmark:runtime:install
pnpm benchmark:runtime:smoke
pnpm benchmark:runtime:native
pnpm benchmark:runtime
```

### What each step does

1. **`pnpm benchmark:prepare`**
   - Builds `@lightfastgrid/core` then `@lightfastgrid/react`
   - Packs them with `pnpm pack` (not workspace source imports)
   - Writes:
     - `benchmarks/artifacts/lightfastgrid-core.tgz`
     - `benchmarks/artifacts/lightfastgrid-react.tgz`
   - Reads the untouched packed manifests (`tar -xOf` only) and **fails** if
     packed React does not already depend on the exact packed Core version.
     `pnpm pack` converts `workspace:*`; the harness does not rewrite tarballs.
   - Asserts both tarballs stay byte-for-byte unchanged through validation and
     install
   - Refreshes the isolated `benchmarks/` lockfile and `node_modules` (not the
     global pnpm store) and installs from that directory’s
     `pnpm-workspace.yaml` overrides that deliberately install the locally
     packed tarballs so a registry package cannot be used accidentally
   - Fails clearly if build, pack, manifest validation, or install fails

2. **`pnpm benchmark:verify`**
   - Confirms both tarballs exist
   - Confirms packed React depends on the exact packed Core version
   - Confirms the LightFastGrid React app resolves both packages from installed
     `node_modules` (realpath is **not** `packages/core` or `packages/react`)
   - Confirms the LightFastGrid Vanilla app resolves Core from the same packed
     tarball (realpath is **not** under `packages/`)
   - Confirms packed Core includes hashed Worker files and addresses them
     with package-relative `import.meta.url` (not site-root `/assets/`)
   - Confirms AG Grid Vanilla resolves locked `ag-grid-community@36.1.0` and
     does not depend on `ag-grid-react` or Enterprise
   - Confirms the Vanilla baseline has no grid dependency
   - Confirms none of the three Vanilla apps declare or install React/ReactDOM
   - Typechecks all six apps (`tsc --noEmit`)
   - Confirms default scenario checksums are deterministic
   - Confirms `extreme` is not in the default list and is not generated
   - Confirms bundle entries do not import protocol/driver modules
   - Confirms runtime entries still install the protocol
   - Confirms Quick Search displayed-row helper behavior and listener cleanup

3. **`pnpm benchmark:build`**
   - Typechecks all six apps (`tsc --noEmit`) before Vite runs
   - Cleans each app `dist/`, then production-builds **bundle** and **runtime**
     modes (Vite `8.0.10`, oxc minify, source maps off, manifest on, `es2022`)
   - Pass `bundle` or `runtime` as the first argument to build one mode
   - Runs `verify-static-preview.mjs`: HTTP/static check of HTML, referenced
     assets, Vite manifests, non-empty JavaScript, and successful Vite Preview
     serving. **This does not execute the app, mount a grid, or run the
     protocol.** Browser execution is `pnpm benchmark:runtime`.

4. **`pnpm benchmark:bundle-sizes`**
   - Builds are not implied; measure **`dist/bundle` only**
   - Measures raw / gzip / Brotli JS and CSS per app
   - Splits initial JS vs lazy/worker JS from the Vite manifest
   - Fails if any Worker URL in either LightFastGrid **bundle** dist does not
     resolve to an emitted file, or if sort/filter/quickSearch Workers are
     missing (CSV may tree-shake; those three must be present). The same
     Worker check runs on runtime dists during `benchmark:build`
   - Fails if a Vanilla bundle `module-inventory.json` (Vite/Rollup
     `chunk.modules` / `moduleIds`) includes `react`, `react-dom`,
     `react/jsx-runtime`, or `@lightfastgrid/react`. A minified-string marker
     scan remains a secondary defense
   - Fails if bundle JS contains `__GRID_BENCHMARK__`
   - Writes `benchmarks/results/bundle-sizes.json` (gitignored)
   - Records `methodology.buildMode: "bundle"`
   - Reports two lanes (`react` and `vanilla`) with complete totals as primary
   - Places incremental estimates only under `lanes.<lane>.incrementalGridEstimate`
   - Labels any `grid − matching baseline` figure as an **estimate**
   - Never combines React and Vanilla percentages
   - Does not measure `.map` files, source fixtures, generated datasets, or
     `dist/runtime`

5. **`node benchmarks/scripts/capture-environment.mjs`**
   - Writes `benchmarks/results/environment.json` (gitignored)
   - Records time, git commit, dirty worktree, OS, CPU, RAM, Node, pnpm,
     packed LightFastGrid versions, AG Grid versions, scenario seed/dimensions
   - Browser/version is recorded in each `results/runtime/<run-id>/environment.json`
     when Playwright runs

6. **`pnpm benchmark:runtime:install`**
   - Installs Playwright Chromium once. Normal runtime commands do **not**
     reinstall the browser; they fail with this instruction if it is missing.

7. **`pnpm benchmark:runtime:smoke`**
   - 10,000 × 20, 1 warmup round, 1 measured round, interleaved AB/BA per lane
   - Requests 4× CDP CPU throttling; if CDP cannot apply it, the run records
     that state and is **not** publishable
   - Exact correctness checks only; diagnostic statistics; **not** Worker
     performance evidence (below the 25,000-row threshold)
   - Warmup errors stay visible; smoke never becomes publishable
   - Writes `benchmarks/results/runtime/<run-id>/` (gitignored)

8. **`pnpm benchmark:runtime`**
   - 4× publish profile: 100,000 × 50, 3 warmup rounds, at least 10 measured
     rounds (set `LFG_BENCH_PUBLISH_ITERATIONS=20` to prefer 20)
   - Requires 4× CDP `Emulation.setCPUThrottlingRate` on the **page** before
     timed work. Chromium does not support that command on Worker targets;
     Worker-vs-main-thread numbers stay provisional and non-publishable
   - Required warmups must succeed (one fresh-slot retry). Fails if page
     throttling cannot be applied or a product lacks enough valid measured
     samples
   - Does not publish results.

9. **`pnpm benchmark:runtime:native`**
   - Native 1× public-candidate profile: same 100,000 × 50 schedule as publish
   - No CDP CPU throttling on the page or Worker. Equal compute is native
     machine speed. This is the fair profile for publishable Worker
     comparisons. It does **not** prove 4× throttled performance
   - May be `publishable: true` only when every other publication rule
     passes, including non-provisional Quick Search and Filter comparisons

10. **`pnpm benchmark:runtime:trace`**
   - Captures one identified measured iteration into the run directory
   - Tracing changes performance; results are diagnostic, not published timings

Install-only (after tarballs exist):

```bash
pnpm --dir benchmarks install
```

Do not add these apps to playground production bundles.

## Package boundaries

**LightFastGrid React** (`benchmarks/apps/lightfastgrid`):

```json
"@lightfastgrid/core": "file:../../artifacts/lightfastgrid-core.tgz",
"@lightfastgrid/react": "file:../../artifacts/lightfastgrid-react.tgz"
```

**LightFastGrid Vanilla** (`benchmarks/apps/lightfastgrid-vanilla`):

```json
"@lightfastgrid/core": "file:../../artifacts/lightfastgrid-core.tgz"
```

Vanilla does not install `@lightfastgrid/react`, does not import repository
source, and does not alias Vite to `packages/core`. Production theme CSS is
`@lightfastgrid/core/themes/default.css` from the published package export.

**AG Grid React:** `ag-grid-react@36.1.0` + `ag-grid-community@36.1.0`.

**AG Grid Vanilla:** `ag-grid-community@36.1.0` only, documented `createGrid`
API, `AllCommunityModule`. No Enterprise modules.

**Vanilla baseline:** no React, ReactDOM, LightFastGrid, or AG Grid. It exists
only to provide a clearly labelled Vanilla incremental estimate.

Packed React declares `@lightfastgrid/core` as the exact packed version (for
example `0.1.0`), not `workspace:*`. `pnpm pack` rewrites the authored
`workspace:*` dependency to that exact version. `benchmarks/pnpm-workspace.yaml`
then maps both packages to the locally packed tarballs with pnpm `overrides`.
Those overrides are deliberate so the harness cannot accidentally install the
registry packages instead of the just-packed artifacts. That is an installer
mapping only; it is not a workspace source link. Packed tarballs are never
extracted or recompressed after `pnpm pack`.

Vanilla apps import `@lfg-benchmarks/shared/neutral` (runtime) or
`@lfg-benchmarks/shared/bundle` (bundle mode) plus `./styles.css`. They must
not import the React shared entry or `@lfg-benchmarks/shared/react-shell`.

## Bundle mode versus runtime mode

Each of the six apps has two explicit Vite production modes. Output directories
are `dist/bundle` and `dist/runtime`. Stale `dist/` is deleted before a
harness build.

| Mode | Entry | Purpose |
| --- | --- | --- |
| `bundle` | `src/bundle-main.ts(x)` | Minimal production consumer used **exclusively** for public bundle-size figures |
| `runtime` | `src/runtime-main.ts(x)` | Instrumented app with `window.__GRID_BENCHMARK__` for Playwright Chromium runtime measurements |

`index.html` points at the runtime entry. Vite rewrites that script to the
bundle entry when `--mode bundle`.

**Bundle mode**

- Must not import `protocol.ts` / `protocol.tsx`, `benchmarkProtocol` runtime,
  completion helpers, or expose `window.__GRID_BENCHMARK__`
- Grid apps mount one representative grid from the shared deterministic
  column schema (`createBundleFixture()`). The fixture is a tiny table so
  generated 10k-row datasets are not inlined into public size totals
- Baseline apps include only matching framework / application-shell overhead
- React and Vanilla grid lanes stay feature-equivalent

**Runtime mode**

- Preserves the existing protocol driver, commands, state inspection, reset,
  and completion-boundary behavior
- Is the target of `vite preview` / `preview` scripts
- Is **not** measured for public bundle figures. Runtime driver code exists
  so Playwright can drive the grid; including it in size
  totals would charge instrumentation against the library

Public size totals therefore answer “what does a minimal production consumer
download?”, not “what does the lab driver weigh?”.

## Shared data

Compact JSON lives in `benchmarks/shared/`:

- `scenarios.json` — names, dimensions, opt-in flags, seed `20260906`
- `columns.json` — 20 base column descriptors; extra columns for wide/extreme
- `value-pools.json` — text, status, and category pools

`generateRows.ts` creates rows in memory. Generation time is `generationMs` on
`prepareScenario` and is **never** presented as grid initialization time.
Rows are generated only after `prepareScenario()` is called. Generated arrays
are not committed.

| Scenario | Rows | Columns | Automatic |
| --- | --- | --- | --- |
| `normal` | 10,000 | 20 | yes — smoke runtime profile |
| `runtime-publish` | 100,000 | 50 | yes — canonical public runtime profile; checksum/verify |
| `large-rows` | 200,000 | 20 | checksum/verify only, not page-load |
| `wide` | 10,000 | 100 | checksum/verify only, not page-load |
| `extreme` | 200,000 | 100 | **no** — opt-in, memory-intensive |

Apps do not prepare a scenario until `window.__GRID_BENCHMARK__.prepareScenario(name)`
runs. `extreme` requires `{ allowExtreme: true }` or `?extreme=1`.

Row IDs are `row-0000001`, `row-0000002`, … Mix: stable string IDs, text,
numbers, dates, and status/category values.

## Equivalent grid configuration

Every grid app in both lanes uses:

- Viewport `1280×720`
- Row height `40`, header height `40`, column width `150`
- Overscan intent: LightFastGrid default 5 rows/side; AG Grid `rowBuffer: 5`
- Stable `getRowId`
- No custom cell renderers, no animations, no pagination, no pinned columns
- Sortable, filterable, searchable columns
- LightFastGrid production CSS: `@lightfastgrid/core/themes/default.css`
- AG Grid Community Theming API: `themeQuartz` (no deprecated CSS theme imports)
- Production Vite: `8.0.10`, oxc minify, `es2022`, source maps off, manifest on

React apps additionally use React / ReactDOM `19.2.5`. Vanilla apps do not.

## Complete totals versus incremental estimates

The **primary** result for every app is the complete **bundle-mode**
production payload (JS + CSS, raw / gzip / Brotli), including initial and
lazy/worker JavaScript and emitted file counts. Generated figures are lab
measurements of these six apps on one machine; they are not universal
performance rankings and they do not prove runtime speed.

An incremental figure is reported only inside its lane:

- React: `lightfastgrid − react-baseline` and `ag-grid − react-baseline`
- Vanilla: `lightfastgrid-vanilla − vanilla-baseline` and
  `ag-grid-vanilla − vanilla-baseline`

Those figures are always `{ isEstimate: true }` with the label
“estimate derived by subtracting the matching framework baseline”.

Never subtract the React baseline from a Vanilla app or the Vanilla baseline
from a React app. Never combine the lanes into one percentage.

## Browser protocol

Runtime-mode apps (separately) expose `window.__GRID_BENCHMARK__`. Bundle-mode
apps do not. `pnpm benchmark:runtime` is the Playwright Chromium runner; static
preview verification is not a substitute for that browser execution.

Each runtime grid app exposes:

- `prepareScenario(name)` — releases any previous generated table before
  allocating the next scenario
- `mount()` — includes `waitUntilReady()`; this is the mount-to-ready interval
- `waitUntilReady()` — also callable on its own; idempotent after mount
- `sort(field, direction)`
- `filter(field, value)`
- `quickSearch(text)` — waits for that complete query to settle; it cannot
  represent uninterrupted typing by itself
- `typeQuickSearch({ variant, prefixes, intervalMs })` — one protocol call
  that types `P → Pa → Pat → Pate → Patel`. Burst (primary) uses a 120 ms
  cadence without waiting for intermediate settlement, then waits only after
  the final character. Settled incremental waits for each prefix. Processing
  latency is final keystroke → final paint; cadence waits are not grid time.
  There is no arbitrary sleep after the last character.
- `getQuickSearchExecutionEvidence()` — Worker/main-thread/cache route notes
- `clearOperations()` — inspects current sort/filter/search state, registers
  listeners, issues only the resets that change state, awaits accepted events
  (and LightFastGrid pending=false when pending was observed), then two
  animation frames. Already-clear models do not wait on a no-op event.
- `scrollTo(top, left)`
- `getVisibleState()`
- `getAcceptedState()`
- `getDomNodeCount()`
- `destroy()`
- `getMeta()`
- `startRuntimeObservers()` / `stopRuntimeObservers()` — long tasks, rAF gaps, heap

Completion boundary: the library’s accepted-state event (or documented API
settlement), then two `requestAnimationFrame` callbacks. `mount()` always
waits through that same settlement (`waitUntilReady()`) for both grids.
LightFastGrid Quick Search also waits until `quick-search-pending` is false
when pending was observed, then those two frames. **Timed work ends there.**
Correctness then reads the processed/display row count from a benchmark-only
GridState snapshot (`captureReadSnapshot().fullView.rowCount`). Drivers must
not wait on `.lfg-grid-surface[aria-rowcount]` inside `durationMs` and must
not toggle loading/overlays to force accessibility synchronization.
LightFastGrid Worker sort waits until `.lfg-header-sort-pending` is gone,
then two frames, because `sort:changed` can fire when the SortModel is
accepted before rows commit.
Listeners are always unsubscribed. Timeouts remain 30s.

Do not treat an event that fires before rendering as operation completion.

React Profiler may be added later as supplementary instrumentation. It is not
the primary metric because it misses Worker, layout, and paint work. Vanilla
apps return `null` from `getReactProfileSummary()`.

## Runtime Playwright (Phase 1)

Chromium only. One grid app loaded at a time. React and Vanilla stay separate
lanes. Baselines are bundle-size helpers and are not timed.

**Smoke** (`pnpm benchmark:runtime:smoke`): 10,000 × 20, 1 discarded warmup
round, 1 measured round. Correctness and harness validation only. Diagnostic
statistics; no public P95. This size is below LightFastGrid's 25,000-row
sort/filter/Quick Search Worker threshold, so it is **not** Worker performance
evidence. Warmup errors remain visible. Smoke is never publishable.
Below-threshold `workerIsolated` `worker-route-unconfirmed` samples are
expected diagnostics. Any other invalid measured sample (for example an
unrecorded remount timeout) makes the run incomplete and fails smoke.

**4× publish** (`pnpm benchmark:runtime`): 100,000 × 50, 3 discarded warmup
rounds, at least 10 measured rounds (20 preferred). Requires real 4× Chromium
CPU throttling of the **page** through CDP `Emulation.setCPUThrottlingRate`
applied before `prepareScenario` and timed work. Chromium does not support
that command on Worker targets, so a 4× page with an unthrottled Worker is
unequal compute: Worker-vs-main-thread numbers stay provisional and
non-publishable. Keep this profile for main-thread/UX diagnostics. Dirty
worktrees remain provisional and non-publishable even when operations are
`p95SampleCountEligible`. Required warmups must succeed; one retry uses a
fresh page/grid slot. A successful retry recovers only the matching
first-attempt warmup failure (lane, application, mode, round, slot index,
attempt 0), never another lane, mode, round, retry attempt, measured slot, or
secondary teardown failure.

**Native 1× publish** (`pnpm benchmark:runtime:native`): the same 100,000 × 50
public-candidate schedule with **no** CDP CPU throttling on page or Worker.
Equal compute is native machine speed. React and Vanilla remain separate
lanes. This is the fair profile for publishable Worker comparisons. It does
not prove 4× throttled performance. `publishable: true` also requires
non-provisional Quick Search and Filter comparisons and every other
publication rule.

Each lane uses a deterministic AB/BA schedule (seed `20260906`) of six
identities per round. Competitive slots measure one canonical LightFastGrid
product-default identity and AG Grid for Mount, Sort, Filter, Reset, and
Scroll. Quick Search slots then measure LightFastGrid `workerIsolated`,
forced main thread (`mainThreadIsolated`), `workerProductionOptimized`, and
AG Grid for Quick Search only. Odd rounds reverse the full list. Ordinary
operations are never copied across Quick Search modes. AG Grid is measured
once per equivalent scenario per round. Forced main thread is not a
competitor. Warmups are recorded with `role: "warmup"` and excluded from
published statistics. Generation time is recorded separately and never added
to grid operation time.

LightFastGrid modes (React and Vanilla):

- `workerIsolated` — `quickFilter: { enabled: true, cache: false, prewarm: false }`,
  `execution.thresholds.quickSearch: 25,000`, 100,000-row publish dataset.
  Direct completion producer must be `worker` or the sample is invalid.
  Pending and eligibility are not producer proof. Filter producer is read
  from `scheduleFilter`. Sort producer is read from `scheduleSort` when Core
  calls it. Below the product sort threshold Core does not call
  `scheduleSort`; unknown sort producer is a documented observation limit,
  not a Worker claim.
- `mainThreadIsolated` (`forcedMainThread`) — same except threshold
  `ROW_COUNT + 1` so 100,000 rows stay on the immediate main-thread route.
  The only intentional difference from `workerIsolated` is that threshold.
  Do not describe this as the default configuration.
- `workerProductionOptimized` — cache and prewarm on, threshold 25,000.
  Cold full query, cold realistic typing, primed different-query, repeated
  same-query cache, and settled incremental typing are timed on fresh
  instances. Preserve the exact producer. `unknown` is invalid. `cache` is
  a cache/prewarm result and is never Worker execution. Below the Worker
  threshold, `mainThread` is expected and valid. At or above the threshold,
  `worker` is Worker evidence and `mainThread` is a retained product-
  performance sample that makes Worker-specific comparison provisional.

AG Grid uses `cacheQuickFilter: true` (supported in 36.1.0) as the single
optimized baseline per framework. It has no LightFastGrid-style Quick Search
Worker.

The primary interactive Quick Search test types `P → Pa → Pat → Pate → Patel`
at 120 ms without waiting between keystrokes on a **fresh** grid instance
with no prior `"Patel"` query. Dispatch timestamps are captured immediately
before `setText` so synchronous search work is included in processing
latency. Do not treat a one-shot `quickSearch("Patel")` as that UX
measurement. Settled per-prefix runs are diagnostic only.

Workload per visit:

1. `prepareScenario` — `generationMs` excluded from grid time
2. `mount()` — initial mount and readiness
3. `sort("name", "asc")`, then an unrecorded clear that is still inspected
4. Isolated filter scenarios on a fresh remount each time, using one shared
   neutral AND model (products translate it to public APIs only):
   - `filterTextApply` / `filterTextClear` — `status` contains `"Active"`
   - `filterNumberRangeApply` / `filterNumberRangeClear` — `amount` between
     25,000 and 75,000 inclusive
   - `filterCombinedApply` / `filterCombinedClear` — those two conditions AND
   - `filterTypingBurst` — type `P → Pa → Pat → Pate → Patel` at 120 ms in
     the `name` column filter; cadence waits are not grid time; primary
     metric is final-keystroke-to-final-paint
   Compatibility `filter(field, value)` still exists on the protocol and
   routes through `applyFilterModel`. Recorded identities are the seven
   filter operations above, never a mixed `filter` sample.
5. Isolated Quick Search scenarios, each remounting a fresh grid instance
   (remounts are unrecorded and not mixed into `mount` statistics). AG Grid
   React remount readiness is the current GridApi displayed-row count and
   rows inside that API's `getGridElement()`, after the previous
   `.ag-root-wrapper` has left the host. It does not wait on
   `firstDataRendered` alone:
   - `coldFullQuery` — submit `"Patel"` once, no prior Quick Search
   - `coldRealisticTyping` — type `P → Patel` at 120 ms, no prior Quick Search
   - `primedDifferentQuery` — unrecorded `"Morgan"`, settle, clear, then
     measure `"Patel"` (preparation excluded)
   - `repeatedSameQuery` — unrecorded `"Patel"`, settle, clear without
     recreating the grid, then measure `"Patel"` again
   - `settledIncremental` — diagnostic per-prefix settlement
6. `clearOperations()` — published reset
7. `scrollTo(10000, 0)` — `scrollTop` must match within 2px; rendered rows
    must overlap the expected virtualized index range

Setup resets between Sort and the isolated filter remounts stay out of the
next operation’s latency statistics, but they must leave empty sort/filter/
Quick Search models and the full displayed-row count. A failed reset records
`invalid-setup-state` for the next operation and does not continue from
contaminated state. Each filter scenario remounts a fresh grid. Filter also
requires no active SortModel or Quick Search; Quick Search slots also
require no active SortModel or column filters.

A failed correctness check (accepted model, exact displayed count, or scroll
settlement) invalidates that sample. Invalid samples are written to
`errors.json` and never enter latency statistics. Protocol latency remains
valid even when optional long-task/heap observers are unsupported; those
observers must report `supported: false` with a reason instead of a fake zero.

Harness failures (context create, preview start, page create, guard attach,
navigation, protocol discovery, throttling, preparation, unexpected operation
exceptions, teardown, evidence write) still write partial evidence from a
`finally` boundary and then fail the run. Partial reports set `complete:
false` and `publishable: false`. When a primary harness failure exists,
`fatalReason` is `harness <phase>: <message>`; missing-sample diagnostics
remain in `fatalRunReasons`. Successful runs set `complete: true` and
`fatalReason: null`. Context, page, preview, and guards are cleaned up
independently in reverse order. Runtime preview is a directly owned Node
process running the workspace Vite CLI (`process.execPath`, never `pnpm exec`
or a shell). `stop()` sends SIGTERM, waits a bounded interval, then SIGKILL,
and succeeds only after the owned PID has exited. The first SIGINT or SIGTERM
awaits that stop, prints cleanup failures to stderr, and exits 130 or 143.
A second signal during shutdown force-exits. SIGKILL of the harness
itself cannot be caught, so those preview processes would need a manual
cleanup; production harness code does not `pkill`. If preview HTTP readiness
fails and stopping the owned process also fails, both errors are preserved.
`orchestrator-complete.json`
is written after final publication state and is never `ok: true` after an
evidence-write or teardown failure.

`p95SampleCountEligible` on an operation means only that it has enough valid
samples for a P95. It is not permission to publish. Report-level
`publishable` is the only publication-permission flag. Methodology records
whether the profile intends public-candidate statistics and whether P95
sample counts are sufficient. Quick Search comparison-level provisional
reasons are calculated once and fed into that publication decision. A report
must never be `publishable: true` while `quickSearchModeComparison.provisional`
is true.

Evidence directory: `benchmarks/results/runtime/<utc>-<sha>-<profile>/`
with `summary.json`, `raw-samples.json`, `environment.json`,
`methodology.json`, `errors.json`, and `schedule.json`. Trace mode also
writes `trace.zip`. Raw runtime results stay gitignored.

Primary metric: **median `durationMs`** of protocol settlement (accepted event
+ two animation frames). For typing burst, `durationMs` is final keystroke →
final paint. Secondary: long tasks (including count over 50 ms), rAF gaps
over 20ms (not "dropped frames"), optional heap. No winner field.

`summary.quickSearchModeComparison` reports React and Vanilla tables for
cold full query, cold realistic typing, primed different query, repeated
same-query cache, settled incremental diagnostic, and responsiveness. Each
cell retains scenario identity, mode identity, valid sample count, median,
eligible p95, UX duration, producer distribution, Worker throttle proof,
correctness state, and provisional reasons. Worker execution is not
automatically faster; latency and responsiveness are shown side by side.
Do not claim a Worker win from a smaller longest main-thread task alone,
and do not claim a latency win unless completion time is also lower.
Forced main thread is not a competitor. Worker-vs-main-thread numbers are
not a public competitive claim unless equal compute is confirmed for the
selected profile. 4× page throttling with an unthrottled Worker (Chromium
does not support Worker `Emulation.setCPUThrottlingRate`) stays provisional
and non-publishable. Native 1× `publish-native` records no CDP throttle on
page or Worker and does not prove 4× performance. Missing proof keeps the
raw results and marks the comparison provisional.

## Worker inclusion

Packed Core must ship hashed Worker files under `dist/assets` addressed with
package-relative URLs (ESM `import.meta.url`; CJS
`require("url").pathToFileURL(__dirname+"/").href`). Site-root `/assets/` and
invalid `{}.url` bases are rejected.

For both LightFastGrid production apps (React and Vanilla):

- Every referenced Worker URL must resolve to an emitted file
- Sort, filter, and Quick Search Workers are required
- CSV may be present or tree-shaken; treat it consistently with the existing
  contract (not required in the consumer dist if unused)
- Worker algorithms are not changed to improve the result

`getMeta().gridVersion` is the exact packed package version
(`@lightfastgrid/react` in the React app, `@lightfastgrid/core` in the Vanilla
app), not a placeholder such as `packed-local`.

## Publishing results

Do not commit `benchmarks/results/*.json` as product claims. Do not publish
numbers without repeated controlled runs on documented hardware and browsers.
If `environment.json` reports a dirty worktree, figures are **provisional**
until rerun from a clean committed revision. A dirty worktree does not fail
the runtime command by itself; missing 4× throttling or too few valid measured
samples does. This harness does not fabricate results. Do not treat a local
`bundle-sizes.json` or a smoke runtime run as a product claim.
