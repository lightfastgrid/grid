import type { DomGridFeature, DomGridFeatureContext } from "../types";

import { GridInputController } from "./GridInputController";

/** Neutral pointer-focus ownership. Grid keyboard policy lives in accessibility. */
export function inputFeature(): DomGridFeature {
  let controller: GridInputController | null = null;

  return {
    name: "input",

    attach(ctx: DomGridFeatureContext): void {
      controller = new GridInputController();
      controller.attach(ctx.root, ctx.surface);
    },

    detach(): void {
      controller?.detach();
      controller = null;
    },
  };
}
