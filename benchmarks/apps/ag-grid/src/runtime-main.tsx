import "@lfg-benchmarks/shared/styles.css";

import { createRoot } from "react-dom/client";

import { installBenchmarkProtocol } from "./protocol.tsx";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root");
}

const root = createRoot(container);
installBenchmarkProtocol(root);
