import type { GridSnapshot } from "../../types";

export interface RenderChangeSet {
  readonly changedFieldsByRowId: ReadonlyMap<string, ReadonlySet<string>>;
}

export type GridRenderSnapshot = GridSnapshot & {
  renderChangeSet?: RenderChangeSet;
  /**
   * Transaction cell-change flash metadata for this render only. Distinct
   * from {@link renderChangeSet}: the dirty-patch change set may be cleared
   * when sort/filter/Quick Search requires a full recompute.
   */
  cellChangeFlash?: RenderChangeSet;
};
