import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { browserPolicyAssetsPlugin } from "./scripts/browserPolicyAssets";

export default defineConfig({
  plugins: [react(), browserPolicyAssetsPlugin()],
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "local/**"],
  },
});
