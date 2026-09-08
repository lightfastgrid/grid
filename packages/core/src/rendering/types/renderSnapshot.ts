import type { GridSnapshot } from "../../types";

export interface RenderChangeSet {
  readonly changedFieldsByRowId: ReadonlyMap<string, ReadonlySet<string>>;
}

export type GridRenderSnapshot = GridSnapshot & {
  renderChangeSet?: RenderChangeSet;
};
