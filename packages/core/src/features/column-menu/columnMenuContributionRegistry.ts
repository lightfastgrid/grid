import type { ColumnMenuContribution } from "./types";

export interface ColumnMenuContributionRegistry {
  add(contribution: ColumnMenuContribution): () => void;
  getAll(): readonly ColumnMenuContribution[];
}

export function createColumnMenuContributionRegistry(): ColumnMenuContributionRegistry {
  const contributions: ColumnMenuContribution[] = [];

  return {
    add(contribution) {
      contributions.push(contribution);
      return () => {
        const idx = contributions.indexOf(contribution);
        if (idx >= 0) contributions.splice(idx, 1);
      };
    },
    getAll() {
      return contributions;
    },
  };
}
