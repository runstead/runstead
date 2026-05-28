import { defineConfig } from "vitest/config";

import { cliIntegrationTestFiles } from "./vitest.test-groups.js";

export default defineConfig({
  test: {
    include: cliIntegrationTestFiles
  }
});
