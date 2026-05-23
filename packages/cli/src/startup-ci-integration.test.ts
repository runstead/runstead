import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { installDomainPack } from "./domain-pack-install.js";
import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import {
  formatStartupCiSummary,
  generateStartupCiSummary
} from "./startup-ci-integration.js";

const execFileAsync = promisify(execFile);

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
        remoteActions: {
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
      expect(json.remoteActions.status).toBe("not_configured");
      expect(json.prComment).toContain("Runstead Startup Gate");
      expect(markdown).toContain("Remote GitHub Actions");
      expect(markdown).toContain("Branch Protection");
      expect(formatStartupCiSummary(result)).toContain("Startup CI integration");
      expect(formatStartupCiSummary(result)).toContain(
        "Remote GitHub Actions: not_configured"
      );

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

  it("records remote GitHub Actions status when a GitHub remote and head exist", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ci-remote-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await execFileAsync("git", ["init"], { cwd: workspace });
      await execFileAsync(
        "git",
        ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
        { cwd: workspace }
      );
      await execFileAsync("git", ["commit", "--allow-empty", "-m", "init"], {
        cwd: workspace,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Runstead Test",
          GIT_AUTHOR_EMAIL: "runstead@example.com",
          GIT_COMMITTER_NAME: "Runstead Test",
          GIT_COMMITTER_EMAIL: "runstead@example.com"
        }
      });
      await installDomainPack({
        cwd: workspace,
        ref: "ai-native-startup",
        now: new Date("2026-05-14T01:00:00.000Z")
      });

      const result = await generateStartupCiSummary({
        cwd: workspace,
        stage: "launch",
        fetch: async (url) => {
          expect(url).toContain(
            "https://api.github.com/repos/acme/widgets/actions/runs"
          );
          expect(url).toContain("head_sha=");

          return {
            ok: true,
            status: 200,
            json: async () => ({
              workflow_runs: [
                {
                  name: "CI",
                  status: "completed",
                  conclusion: "success",
                  html_url: "https://github.com/acme/widgets/actions/runs/123"
                }
              ]
            })
          };
        },
        now: new Date("2026-05-14T01:10:00.000Z")
      });
      const markdown = await readFile(result.markdownPath, "utf8");

      expect(result.remoteActions).toMatchObject({
        status: "passed",
        repository: "acme/widgets",
        workflowName: "CI",
        conclusion: "success",
        workflowRunUrl: "https://github.com/acme/widgets/actions/runs/123"
      });
      expect(markdown).toContain("Remote GitHub Actions");
      expect(markdown).toContain("repo=acme/widgets");
      expect(markdown).toContain("conclusion=success");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("blocks the CI summary when startup ready has verdict blockers", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ci-ready-blocked-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await installDomainPack({
        cwd: workspace,
        ref: "ai-native-startup",
        now: new Date("2026-05-14T01:00:00.000Z")
      });

      const result = await generateStartupCiSummary({
        cwd: workspace,
        stage: "launch",
        readiness: {
          verdict: "local_launch_blocked",
          blockers: ["Launch report is blocked"]
        },
        now: new Date("2026-05-14T01:10:00.000Z")
      });
      const json = JSON.parse(await readFile(result.jsonPath, "utf8")) as {
        checkRun: {
          conclusion: string;
          summary: string;
        };
        releaseGate: {
          status: string;
        };
        effectiveGate: {
          readinessVerdict?: string;
          blockers: string[];
        };
      };

      expect(result.checkRun.conclusion).toBe("failure");
      expect(result.releaseGate.status).toBe("block_release");
      expect(result.gate.blockers).toContain("Launch report is blocked");
      expect(json.effectiveGate).toMatchObject({
        readinessVerdict: "local_launch_blocked",
        blockers: expect.arrayContaining(["Launch report is blocked"])
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
