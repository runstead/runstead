import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runOnce } from "./run.js";

describe("runOnce", () => {
  it("creates a run-once result shape", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-run-"));

    try {
      expect(runOnce({ cwd: workspace })).toEqual({
        cwd: workspace,
        ranTask: false,
        reason: "no_task_selected"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
