import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";

describe("initRunstead", () => {
  it("creates the local .runstead scaffold", async () => {
    const workspace = join(tmpdir(), `runstead-cli-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      const result = await initRunstead({ cwd: workspace });
      const config = await readFile(join(result.root, "config.yaml"), "utf8");
      const database = await stat(result.stateDb);

      expect(config).toContain("domain: repo-maintenance");
      expect(database.isFile()).toBe(true);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
