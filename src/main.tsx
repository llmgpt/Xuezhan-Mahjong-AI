import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const asset = (path: string) =>
  new URL(`${import.meta.env.BASE_URL}${path}`, window.location.origin).href;
const strategyAssets = {
  runtimeModuleUrl: asset("strategy/pyodide-314.0.7/pyodide.mjs"),
  runtimeIndexUrl: asset("strategy/pyodide-314.0.7/"),
  payloadUrl: asset("strategy/advanced-public-v1/payload.json"),
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App strategyMode="V10" strategyAssets={strategyAssets} />
  </StrictMode>,
);
