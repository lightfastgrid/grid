import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import GridDemo from "./gridDemo/gridDemo.tsx";

import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GridDemo />
  </StrictMode>,
);
