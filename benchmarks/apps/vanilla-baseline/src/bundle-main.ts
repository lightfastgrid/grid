import "@lfg-benchmarks/shared/styles.css";

import { mountVanillaBenchmarkChrome } from "@lfg-benchmarks/shared/bundle";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root");
}

const chrome = mountVanillaBenchmarkChrome(container, {
  title: "Vanilla baseline",
  label: "vanilla-baseline",
  status: "bundle consumer · no grid mounted",
});
const note = document.createElement("p");
note.className = "benchmark-status";
note.style.padding = "12px";
note.textContent =
  "Vanilla baseline host. Bundle mode includes application-shell overhead only.";
chrome.host.append(note);
