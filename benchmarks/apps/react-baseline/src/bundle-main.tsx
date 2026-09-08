import "@lfg-benchmarks/shared/styles.css";

import { BenchmarkShell, GridHost } from "@lfg-benchmarks/shared/react-shell";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root");
}

createRoot(container).render(
  <StrictMode>
    <BenchmarkShell title="React baseline" status="bundle consumer · no grid mounted">
      <GridHost label="react-baseline">
        <p className="benchmark-status" style={{ padding: 12 }}>
          React baseline host. Bundle mode includes framework and shell overhead only.
        </p>
      </GridHost>
    </BenchmarkShell>
  </StrictMode>,
);
