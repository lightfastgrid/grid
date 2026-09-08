/**
 * Grid **table DOM construction**: skeleton, header row, row template, row pool, primitives.
 *
 * Pure layout math, sizing, and data binding live in sibling `helpers/*.ts` files.
 */

export { buildGridSkeleton } from "./buildGridSkeleton";
export { buildHeaderSlotRow } from "./buildHeaderRow";
export { buildPool } from "./buildPool";
export { buildRowTemplate } from "./buildRowTemplate";
export { createDiv } from "./createDomElement";
