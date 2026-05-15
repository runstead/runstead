import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import {
  createCiRepairTaskFromWorkflowRun,
  formatCiRepairTaskReport,
  isCreatedCiRepairTaskResult,
  repairableWorkflowRunIdFromWebhook,
  type CreateCiRepairTaskFromWorkflowRunResult,
  type CreateCiRepairTaskResult
} from "./ci-repair.js";
import type { GitHubCliRunner } from "./github-actions.js";
import { initRunstead } from "./init.js";

describe("createCiRepairTaskFromWorkflowRun", () => {
  it("creates a CI repair task with workflow run evidence", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-repair-"));
    const calls: { args: string[]; env?: Record<string, string> }[] = [];
    const runner: GitHubCliRunner = (args, options) => {
      calls.push({
        args,
        ...(options.env === undefined ? {} : { env: options.env })
      });

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
        authToken: "ghs_app_token",
        runner,
        now: new Date("2026-05-14T11:00:00.000Z")
      });
      expectCreatedCiRepair(result);
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
          failureClassification: { category: string; summary: string };
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
        const toolCalls = database
          .prepare("SELECT action_type, status FROM tool_calls ORDER BY started_at, id")
          .all() as { action_type: string; status: string }[];
        const workerRuns = database
          .prepare(
            "SELECT worker_type, status FROM worker_runs ORDER BY started_at, id"
          )
          .all() as { worker_type: string; status: string }[];

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
          },
          failureClassification: {
            category: "test",
            summary: "Test verification failed"
          }
        });
        expect(evidence).toMatchObject({
          type: "github_workflow_run",
          subject_id: result.task.id,
          summary: "Verify failure run 123 24 log bytes"
        });
        expect(artifact.workflowRun.conclusion).toBe("failure");
        expect(artifact.failureClassification).toMatchObject({
          category: "test",
          summary: "Test verification failed"
        });
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
        expect(toolCalls).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action_type: "github.run.read",
              status: "completed"
            }),
            expect.objectContaining({
              action_type: "github.run.log.read",
              status: "completed"
            })
          ])
        );
        expect(workerRuns).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              worker_type: "ci_repair_intake",
              status: "completed"
            })
          ])
        );
        expect(calls.map((call) => call.args.slice(0, 3))).toEqual([
          ["run", "view", "123"],
          ["run", "view", "123"]
        ]);
        expect(calls.map((call) => call.env)).toEqual([
          { GH_TOKEN: "ghs_app_token" },
          { GH_TOKEN: "ghs_app_token" }
        ]);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("reuses an existing CI repair task for duplicate workflow run intake", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-repair-dedupe-"));
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

      const first = await createCiRepairTaskFromWorkflowRun({
        cwd: workspace,
        runId: "123",
        runner,
        now: new Date("2026-05-14T11:10:00.000Z")
      });
      const second = await createCiRepairTaskFromWorkflowRun({
        cwd: workspace,
        runId: "123",
        runner: () => {
          throw new Error("duplicate intake should not call GitHub");
        },
        now: new Date("2026-05-14T11:11:00.000Z")
      });
      expectCreatedCiRepair(first);
      expectCreatedCiRepair(second);
      const database = openRunsteadDatabase(second.stateDb);

      try {
        const tasks = database
          .prepare("SELECT id FROM tasks WHERE type = 'ci_repair'")
          .all() as { id: string }[];
        const evidence = database
          .prepare("SELECT id FROM evidence WHERE type = 'github_workflow_run'")
          .all() as { id: string }[];

        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.task.id).toBe(first.task.id);
        expect(second.evidence.id).toBe(first.evidence.id);
        expect(second.evidencePath).toBe(first.evidencePath);
        expect(second.workflowRun).toEqual(first.workflowRun);
        expect(second.log).toEqual(first.log);
        expect(tasks).toEqual([{ id: first.task.id }]);
        expect(evidence).toEqual([{ id: first.evidence.id }]);
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
            "api_key: sk-live-123456",
            "AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF",
            "curl -H 'Authorization: Bearer abc.def.ghi'",
            "curl -H 'Authorization: Basic dXNlcjpwYXNz'",
            "token ghp_abcdefghijklmnopqrstuvwxyz",
            "-----BEGIN PRIVATE KEY-----",
            "private-key-material",
            "-----END PRIVATE KEY-----"
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
      expectCreatedCiRepair(result);
      const artifact = JSON.parse(await readFile(result.evidencePath, "utf8")) as {
        log: { log: string };
      };

      expect(artifact.log.log).toContain("AUTH_TOKEN=[REDACTED]");
      expect(artifact.log.log).toContain("api_key: [REDACTED]");
      expect(artifact.log.log).toContain("AWS_ACCESS_KEY_ID=[REDACTED]");
      expect(artifact.log.log).toContain("Bearer [REDACTED]");
      expect(artifact.log.log).toContain("Basic [REDACTED]");
      expect(artifact.log.log).toContain("[REDACTED_GITHUB_TOKEN]");
      expect(artifact.log.log).toContain("[REDACTED_PRIVATE_KEY]");
      expect(artifact.log.log).not.toContain("secret-value");
      expect(artifact.log.log).not.toContain("sk-live-123456");
      expect(artifact.log.log).not.toContain("AKIA1234567890ABCDEF");
      expect(artifact.log.log).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
      expect(artifact.log.log).not.toContain("private-key-material");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("classifies ecosystem-specific CI failure signals", async () => {
    const scenarios = [
      {
        name: "playwright assertion timeout",
        log: [
          "Running 1 test using 1 worker",
          "Error: expect(locator).toBeVisible() failed",
          "Timeout 5000ms exceeded.",
          "@playwright/test"
        ].join("\n"),
        expectedCategory: "test"
      },
      {
        name: "pytest assertion failure",
        log: [
          "============================= test session starts =============================",
          "FAILED tests/test_api.py::test_health - AssertionError: expected 200"
        ].join("\n"),
        expectedCategory: "test"
      },
      {
        name: "cargo compile failure",
        log: [
          "error[E0425]: cannot find value `missing` in this scope",
          "error: could not compile `runstead-fixture` (lib) due to 1 previous error"
        ].join("\n"),
        expectedCategory: "build"
      },
      {
        name: "pnpm frozen lockfile failure",
        log: [
          "ERR_PNPM_OUTDATED_LOCKFILE Cannot install with frozen-lockfile",
          "pnpm-lock.yaml is not up to date with package.json"
        ].join("\n"),
        expectedCategory: "dependency_install"
      }
    ] as const;

    for (const scenario of scenarios) {
      const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-classify-"));

      try {
        await initRunstead({
          cwd: workspace,
          createDefaultGoal: true
        });

        const result = await createCiRepairTaskFromWorkflowRun({
          cwd: workspace,
          runId: scenario.name,
          runner: classificationRunner(scenario.log),
          now: new Date("2026-05-14T11:07:00.000Z")
        });

        expect(result.task.input).toMatchObject({
          failureClassification: {
            category: scenario.expectedCategory
          }
        });
      } finally {
        await rm(workspace, { force: true, recursive: true });
      }
    }
  });

  it("returns an ignored result for successful workflow runs", async () => {
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

      const result = await createCiRepairTaskFromWorkflowRun({
        cwd: workspace,
        runId: "123",
        runner
      });

      expect(result).toMatchObject({
        status: "ignored",
        reason: "workflow_not_repairable",
        taskStatus: "cancelled",
        error: expect.stringContaining("expected repairable failure")
      });
      expect(formatCiRepairTaskReport(result)).toContain("Status: ignored");

      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

      try {
        const tasks = database
          .prepare("SELECT status, output_json FROM tasks WHERE type = 'ci_repair'")
          .all() as { status: string; output_json: string | null }[];
        const workerRuns = database
          .prepare("SELECT worker_type, status, output_json FROM worker_runs")
          .all() as {
          worker_type: string;
          status: string;
          output_json: string | null;
        }[];

        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({
          status: "cancelled"
        });
        const failedTaskOutput = JSON.parse(tasks[0]?.output_json ?? "{}") as {
          error?: string;
        };
        expect(failedTaskOutput.error).toContain("expected repairable failure");
        expect(workerRuns).toEqual([
          expect.objectContaining({
            worker_type: "ci_repair_intake",
            status: "completed"
          })
        ]);
        const workerOutput = JSON.parse(workerRuns[0]?.output_json ?? "{}") as {
          reason?: string;
        };

        expect(workerOutput.reason).toBe("workflow_not_repairable");
      } finally {
        database.close();
      }
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

function expectCreatedCiRepair(
  result: CreateCiRepairTaskFromWorkflowRunResult
): asserts result is CreateCiRepairTaskResult {
  expect(result.status).toBe("created");

  if (!isCreatedCiRepairTaskResult(result)) {
    throw new Error(`Expected created CI repair result, got ${result.status}`);
  }
}

function classificationRunner(log: string): GitHubCliRunner {
  return (args) => {
    if (args.includes("--log")) {
      return Promise.resolve({
        stdout: log,
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
}
