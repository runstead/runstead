import { configDefaults, defineConfig } from "vitest/config";

import { cliIntegrationTestFiles } from "./vitest.test-groups.js";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ...cliIntegrationTestFiles]
  }
});
