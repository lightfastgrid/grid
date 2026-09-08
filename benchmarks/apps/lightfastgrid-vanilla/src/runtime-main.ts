import "@lightfastgrid/core/themes/default.css";
import "@lfg-benchmarks/shared/styles.css";

import { installBenchmarkProtocol } from "./protocol.ts";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root");
}

installBenchmarkProtocol(container);
