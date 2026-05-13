import { readFile, readdir, rm, stat } from "node:fs/promises";
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
      const goalTemplate = await readFile(
        join(
          result.root,
          "domains",
          "repo-maintenance",
          "goal-templates",
          "keep-ci-green.yaml"
        ),
        "utf8"
      );
      const domainPolicy = await readFile(
        join(
          result.root,
          "domains",
          "repo-maintenance",
          "policies",
          "repo-maintenance.yaml"
        ),
        "utf8"
      );
      const database = await stat(result.stateDb);
      const evidenceFiles = await readdir(join(result.root, "evidence"));

      expect(config).toContain("domain: repo-maintenance");
      expect(goalTemplate).toContain("id: keep-ci-green");
      expect(domainPolicy).toContain("id: policy_repo_maintenance_v1");
      expect(database.isFile()).toBe(true);
      expect(evidenceFiles).toEqual([
        expect.stringMatching(/^repo-inspection-ev_[a-f0-9]+\.json$/)
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
