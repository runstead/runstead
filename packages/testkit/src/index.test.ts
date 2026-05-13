import { stat } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createTempWorkspace } from "./index.js";

describe("createTempWorkspace", () => {
  it("creates a cleanup-capable temporary directory", async () => {
    const workspace = await createTempWorkspace("runstead-testkit-");

    try {
      const pathStat = await stat(workspace.path);
      expect(pathStat.isDirectory()).toBe(true);
    } finally {
      await workspace.cleanup();
    }
  });
});
