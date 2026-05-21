import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { installDomainPack } from "./domain-pack-install.js";
import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import {
  formatStartupCiSummary,
  generateStartupCiSummary
} from "./startup-ci-integration.js";

describe("startup CI integration", () => {
  it("writes GitHub check, PR comment, release gate, and CI artifact output", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ci-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      const initialized = await initRunstead({ cwd: workspace });
      await installDomainPack({
        cwd: workspace,
        ref: "ai-native-startup",
        now: new Date("2026-05-14T01:00:00.000Z")
      });
      await createGoal({
        cwd: workspace,
        domain: "ai-native-startup",
        template: "build-mvp",
        now: new Date("2026-05-14T01:05:00.000Z")
      });

      const result = await generateStartupCiSummary({
        cwd: workspace,
        stage: "launch",
        checkName: "Runstead Launch Gate",
        now: new Date("2026-05-14T01:10:00.000Z")
      });
      const json = JSON.parse(await readFile(result.jsonPath, "utf8")) as {
        checkRun: {
          name: string;
          conclusion: string;
        };
        releaseGate: {
          status: string;
        };
        prComment: string;
      };
      const markdown = await readFile(result.markdownPath, "utf8");

      expect(result.checkRun).toMatchObject({
        name: "Runstead Launch Gate",
        conclusion: "failure"
      });
      expect(result.releaseGate.status).toBe("block_release");
      expect(json.checkRun.conclusion).toBe("failure");
      expect(json.releaseGate.status).toBe("block_release");
      expect(json.prComment).toContain("Runstead Startup Gate");
      expect(markdown).toContain("Branch Protection");
      expect(formatStartupCiSummary(result)).toContain("Startup CI integration");

      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const row = database
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id
            FROM events
            WHERE event_id = ?
          `
          )
          .get(result.event.eventId) as {
          type: string;
          aggregate_type: string;
          aggregate_id: string;
        };

        expect(row).toEqual({
          type: "startup_ci.summary_generated",
          aggregate_type: "startup_ci",
          aggregate_id: "ai-native-startup_launch"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
