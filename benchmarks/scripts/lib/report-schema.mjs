import { LANES } from "./paths.mjs";

export function assertBundleSizeReport(report) {
  if (Object.prototype.hasOwnProperty.call(report, "incrementalGridEstimate")) {
    throw new Error(
      "bundle-sizes.json must not have a top-level incrementalGridEstimate. Estimates are lane-specific under lanes.react and lanes.vanilla.",
    );
  }
  if (report.methodology?.buildMode !== "bundle") {
    throw new Error('bundle-sizes.json methodology.buildMode must be "bundle"');
  }
  if (!report.lanes?.react || !report.lanes?.vanilla) {
    throw new Error("bundle-sizes.json must report lanes.react and lanes.vanilla");
  }
  for (const lane of Object.values(LANES)) {
    const laneReport = report.lanes[lane.id];
    if (laneReport.baselineAppId !== lane.baselineAppId) {
      throw new Error(
        `${lane.id} lane baseline must be ${lane.baselineAppId}, found ${laneReport.baselineAppId}`,
      );
    }
    const estimates = laneReport.incrementalGridEstimate;
    if (!estimates || typeof estimates !== "object") {
      throw new Error(`${lane.id} lane is missing incrementalGridEstimate`);
    }
    for (const gridAppId of lane.gridAppIds) {
      const estimate = estimates[gridAppId];
      if (!estimate?.isEstimate) {
        throw new Error(`${gridAppId} incremental figure must set isEstimate: true`);
      }
      if (estimate.baselineAppId !== lane.baselineAppId) {
        throw new Error(
          `${gridAppId} estimate baselineAppId must be the matching ${lane.id} baseline ${lane.baselineAppId}`,
        );
      }
    }
  }
  const reactBaseline = report.lanes.react.baselineAppId;
  const vanillaBaseline = report.lanes.vanilla.baselineAppId;
  if (reactBaseline === vanillaBaseline) {
    throw new Error("React and Vanilla lanes must not share a baseline");
  }
}
