import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import {
  createCiRepairTaskFromWorkflowRun,
  formatCiRepairTaskReport,
  repairableWorkflowRunIdFromWebhook
} from "./ci-repair.js";
import type { GitHubCliRunner } from "./github-actions.js";
import { initRunstead } from "./init.js";

describe("createCiRepairTaskFromWorkflowRun", () => {
  it("creates a CI repair task with workflow run evidence", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-repair-"));
    const calls: string[][] = [];
    const runner: GitHubCliRunner = (args) => {
      calls.push(args);

      if (args.includes("--log")) {
        return Promise.resolve({
          stdout: "build\tstep\tfailing test\n",
          stderr: "",
          exitCode: 0
        });
      }

      return Promise.resolve({
        stdout: JSON.stringify({
          databaseId: 123,
          workflowName: "Verify",
          displayTitle: "CI",
          status: "completed",
          conclusion: "failure",
          event: "push",
          headBranch: "main",
          headSha: "abc123",
          url: "https://github.com/acme/widgets/actions/runs/123"
        }),
        stderr: "",
        exitCode: 0
      });
    };

    try {
      await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });

      const result = await createCiRepairTaskFromWorkflowRun({
        cwd: workspace,
        runId: "123",
        runner,
        now: new Date("2026-05-14T11:00:00.000Z")
      });
      const database = openRunsteadDatabase(result.stateDb);

      try {
        const task = database
          .prepare("SELECT type, status, priority, input_json FROM tasks WHERE id = ?")
          .get(result.task.id) as {
          type: string;
          status: string;
          priority: string;
          input_json: string;
        };
        const evidence = database
          .prepare("SELECT type, subject_id, summary FROM evidence WHERE id = ?")
          .get(result.evidence.id) as {
          type: string;
          subject_id: string;
          summary: string;
        };
        const artifact = JSON.parse(await readFile(result.evidencePath, "utf8")) as {
          metadata: {
            trust: string;
            source: string;
            redacted: boolean;
            used_for_prompt: boolean;
          };
          workflowRun: { conclusion: string };
          log: { log: string };
        };
        const evidenceEvent = database
          .prepare(
            `
            SELECT payload_json
            FROM events
            WHERE type = 'evidence.recorded' AND aggregate_id = ?
          `
          )
          .get(result.evidence.id) as { payload_json: string };

        expect(task).toMatchObject({
          type: "ci_repair",
          status: "queued",
          priority: "high"
        });
        expect(JSON.parse(task.input_json)).toMatchObject({
          source: "github_actions",
          runId: "123",
          logEvidenceMetadata: {
            trust: "untrusted_external",
            source: "github_actions_log",
            redacted: true,
            used_for_prompt: false
          }
        });
        expect(evidence).toMatchObject({
          type: "github_workflow_run",
          subject_id: result.task.id,
          summary: "Verify failure run 123 24 log bytes"
        });
        expect(artifact.workflowRun.conclusion).toBe("failure");
        expect(artifact.metadata).toEqual({
          trust: "untrusted_external",
          source: "github_actions_log",
          redacted: true,
          used_for_prompt: false
        });
        expect(artifact.log.log).toContain("failing test");
        expect(JSON.parse(evidenceEvent.payload_json)).toMatchObject({
          metadata: {
            trust: "untrusted_external",
            source: "github_actions_log",
            redacted: true,
            used_for_prompt: false
          }
        });
        expect(formatCiRepairTaskReport(result)).toContain(`Task: ${result.task.id}`);
        expect(calls.map((args) => args.slice(0, 3))).toEqual([
          ["run", "view", "123"],
          ["run", "view", "123"]
        ]);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("redacts secret-like strings before storing workflow log evidence", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-repair-"));
    const runner: GitHubCliRunner = (args) => {
      if (args.includes("--log")) {
        return Promise.resolve({
          stdout: [
            "AUTH_TOKEN=secret-value",
            "curl -H 'Authorization: Bearer abc.def.ghi'",
            "token ghp_abcdefghijklmnopqrstuvwxyz"
          ].join("\n"),
          stderr: "",
          exitCode: 0
        });
      }

      return Promise.resolve({
        stdout: JSON.stringify({
          databaseId: 123,
          workflowName: "Verify",
          status: "completed",
          conclusion: "failure"
        }),
        stderr: "",
        exitCode: 0
      });
    };

    try {
      await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });

      const result = await createCiRepairTaskFromWorkflowRun({
        cwd: workspace,
        runId: "123",
        runner,
        now: new Date("2026-05-14T11:05:00.000Z")
      });
      const artifact = JSON.parse(await readFile(result.evidencePath, "utf8")) as {
        log: { log: string };
      };

      expect(artifact.log.log).toContain("AUTH_TOKEN=[REDACTED]");
      expect(artifact.log.log).toContain("Bearer [REDACTED]");
      expect(artifact.log.log).toContain("[REDACTED_GITHUB_TOKEN]");
      expect(artifact.log.log).not.toContain("secret-value");
      expect(artifact.log.log).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects successful workflow runs", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-repair-"));
    const runner: GitHubCliRunner = (args) => {
      if (args.includes("--log")) {
        return Promise.resolve({
          stdout: "",
          stderr: "",
          exitCode: 0
        });
      }

      return Promise.resolve({
        stdout: JSON.stringify({
          status: "completed",
          conclusion: "success"
        }),
        stderr: "",
        exitCode: 0
      });
    };

    try {
      await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });

      await expect(
        createCiRepairTaskFromWorkflowRun({
          cwd: workspace,
          runId: "123",
          runner
        })
      ).rejects.toThrow("expected repairable failure");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("extracts repairable workflow_run webhook ids", () => {
    expect(
      repairableWorkflowRunIdFromWebhook("workflow_run", {
        action: "completed",
        workflow_run: {
          id: 456,
          status: "completed",
          conclusion: "failure"
        }
      })
    ).toBe("456");
    expect(
      repairableWorkflowRunIdFromWebhook("workflow_run", {
        action: "completed",
        workflow_run: {
          id: 456,
          status: "completed",
          conclusion: "success"
        }
      })
    ).toBeUndefined();
  });
});
