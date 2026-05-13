import { cp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { doctorRunstead } from "./doctor.js";
import { initRunstead } from "./init.js";

describe("doctorRunstead", () => {
  it("passes for an initialized workspace", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-ok-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace });

      const result = await doctorRunstead({ cwd: workspace });

      expect(result.ok).toBe(true);
      expect(result.checks.map((check) => check.id)).toEqual(
        expect.arrayContaining([
          "config",
          "events",
          "domain-pack",
          "policy",
          "state-db"
        ])
      );
      expect(result.checks.every((check) => check.status === "pass")).toBe(true);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails with concrete checks for an uninitialized workspace", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-missing-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });

      const result = await doctorRunstead({ cwd: workspace });

      expect(result.ok).toBe(false);
      expect(
        result.checks.filter((check) => check.status === "fail").length
      ).toBeGreaterThan(0);
      expect(result.checks.find((check) => check.id === "state-db")?.status).toBe(
        "fail"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("passes for a legacy .team workspace", async () => {
    const workspace = join(tmpdir(), `runstead-doctor-team-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await initRunstead({ cwd: workspace });
      await cp(join(workspace, ".runstead"), join(workspace, ".team"), {
        recursive: true
      });
      await rm(join(workspace, ".runstead"), { force: true, recursive: true });

      const result = await doctorRunstead({ cwd: workspace });

      expect(result.ok).toBe(true);
      expect(result.root).toBe(join(workspace, ".team"));
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
