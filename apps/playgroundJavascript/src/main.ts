import { startGridDemo } from "./gridDemo/index.ts";

import "./styles.css";

const demoRoot = document.querySelector("#demo-root");
const host = document.querySelector("#grid-host");
const statusLine = document.querySelector("#status-line");
const toolbarHost = document.querySelector("#interactive-demo-toolbar");

if (!(demoRoot instanceof HTMLElement)) {
  throw new Error("Missing #demo-root");
}
if (!(host instanceof HTMLElement)) {
  throw new Error("Missing #grid-host");
}
if (!(statusLine instanceof HTMLElement)) {
  throw new Error("Missing #status-line");
}
if (!(toolbarHost instanceof HTMLElement)) {
  throw new Error("Missing #interactive-demo-toolbar");
}

void startGridDemo({
  host,
  statusLine,
  toolbarHost,
  demoRoot,
});
