import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Goal, Task } from "@runstead/core";
import { describe, expect, it } from "vitest";

import {
  buildWrappedWorkerGovernanceManifest,
  buildWrappedWorkerPrompt,
  startWrappedWorker,
  workerCommand,
  type WorkerProcessRunner
} from "./wrapped-worker.js";

const goal: Goal = {
  id: "goal_repo_001",
  domain: "repo-maintenance",
  title: "Stabilize CI",
  status: "active",
  priority: "high",
  scope: {
    repository: "acme/widgets"
  },
  createdAt: "2026-05-14T00:00:00.000Z",
  updatedAt: "2026-05-14T00:00:00.000Z"
};

const task: Task = {
  id: "task_ci_001",
  goalId: goal.id,
  domain: "repo-maintenance",
  type: "fix_ci_failure",
  status: "queued",
  priority: "high",
  attempt: 0,
  maxAttempts: 2,
  input: {
    workflowRunId: "123"
  },
  verifiers: ["command:test"],
  createdAt: "2026-05-14T00:01:00.000Z",
  updatedAt: "2026-05-14T00:01:00.000Z"
};

describe("buildWrappedWorkerPrompt", () => {
  it("builds a constrained prompt with policy and verifier requirements", () => {
    const prompt = buildWrappedWorkerPrompt({
      worker: "claude_code",
      goal,
      task,
      workspace: "/repo",
      evidenceDir: "/repo/.runstead/evidence",
      policySummary: "repo-maintenance policy",
      allowedScope: ["src/**", "packages/**"],
      deniedActions: ["modify .github/workflows/**"],
      approvalRequired: ["dependency changes"],
      instructions: ["Keep the diff small."]
    });

    expect(prompt).toContain("You are a Runstead worker.");
    expect(prompt).toContain("Stabilize CI (goal_repo_001)");
    expect(prompt).toContain("fix_ci_failure (task_ci_001)");
    expect(prompt).toContain("- src/**");
    expect(prompt).toContain("- modify .github/workflows/**");
    expect(prompt).toContain("- command:test");
    expect(prompt).toContain("Runstead governance manifest:");
    expect(prompt).toContain('"enforcement": "policy_gated_wrapper"');
    expect(prompt).toContain("worker-internal tool calls are not hard-proxied");
    expect(prompt).toContain('"allowedScope":');
    expect(prompt).toContain("repo-maintenance policy");
    expect(prompt).toContain("Completion requires Runstead verifier success.");
    expect(prompt).toContain('"needs_approval": false');
    expect(prompt).toContain("- Keep the diff small.");
  });

  it("builds a machine-readable governance manifest", () => {
    expect(
      buildWrappedWorkerGovernanceManifest({
        worker: "codex_cli",
        goal,
        task,
        workspace: "/repo",
        evidenceDir: "/repo/.runstead/evidence",
        allowedScope: ["src/**"],
        deniedActions: [".env"],
        approvalRequired: ["external writes"],
        verifierContract: ["test: pnpm test"]
      })
    ).toEqual({
      worker: "codex_cli",
      taskId: "task_ci_001",
      goalId: "goal_repo_001",
      domain: "repo-maintenance",
      workspace: "/repo",
      evidenceDir: "/repo/.runstead/evidence",
      enforcement: "policy_gated_wrapper",
      enforcementNotes: [
        "Runstead policy-gates worker launch.",
        "Runstead verifies diff scope and command evidence after the worker exits.",
        "Worker-internal tool calls are not hard-proxied in wrapper mode."
      ],
      allowedScope: ["src/**"],
      deniedActions: [".env"],
      approvalRequired: ["external writes"],
      verifierContract: ["test: pnpm test"]
    });
  });
});

describe("workerCommand", () => {
  it("maps worker kinds to their CLI invocations", () => {
    expect(workerCommand("claude_code", "prompt")).toEqual({
      command: "claude",
      args: ["-p", "prompt"]
    });
    expect(workerCommand("codex_cli", "prompt")).toEqual({
      command: "codex",
      args: ["exec", "prompt"]
    });
  });
});

describe("startWrappedWorker", () => {
  it("starts the selected worker through an injectable process runner", async () => {
    const calls: {
      command: string;
      args: string[];
      cwd: string;
      timeoutMs?: number;
      maxOutputBytes?: number;
    }[] = [];
    const runner: WorkerProcessRunner = (command, args, options) => {
      calls.push({
        command,
        args,
        cwd: options.cwd,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.maxOutputBytes === undefined
          ? {}
          : { maxOutputBytes: options.maxOutputBytes })
      });

      return Promise.resolve({
        stdout: '{"summary":"done"}',
        stderr: "",
        exitCode: 0
      });
    };

    const result = await startWrappedWorker({
      worker: "codex_cli",
      goal,
      task,
      workspace: "/repo",
      evidenceDir: "/repo/.runstead/evidence",
      runner
    });

    expect(result).toMatchObject({
      worker: "codex_cli",
      command: "codex",
      stdout: '{"summary":"done"}',
      stderr: "",
      exitCode: 0
    });
    expect(result.args[0]).toBe("exec");
    expect(result.args[1]).toBe(result.prompt);
    expect(result.governance).toMatchObject({
      worker: "codex_cli",
      taskId: "task_ci_001",
      enforcement: "policy_gated_wrapper"
    });
    expect(calls).toEqual([
      {
        command: "codex",
        args: ["exec", result.prompt],
        cwd: "/repo",
        timeoutMs: 1_800_000,
        maxOutputBytes: 10485760
      }
    ]);
  });

  it("creates a checkpoint before starting a wrapped worker", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-worker-"));
    const checkpointDir = join(workspace, ".runstead", "checkpoints");
    const gitCalls: string[][] = [];
    const runner: WorkerProcessRunner = () =>
      Promise.resolve({
        stdout: '{"summary":"done"}',
        stderr: "",
        exitCode: 0
      });

    try {
      const result = await startWrappedWorker({
        worker: "codex_cli",
        goal,
        task,
        workspace,
        evidenceDir: join(workspace, ".runstead", "evidence"),
        checkpointDir,
        checkpointRunner: (args) => {
          gitCalls.push(args);

          return Promise.resolve({
            stdout: args[0] === "rev-parse" ? "abc123\n" : "",
            stderr: "",
            exitCode: 0
          });
        },
        runner
      });

      expect(result.checkpointBefore).toMatchObject({
        workspace,
        checkpointDir,
        head: "abc123"
      });
      expect(gitCalls).toEqual([
        ["rev-parse", "HEAD"],
        ["status", "--short"],
        ["diff", "--binary", "HEAD"],
        ["ls-files", "--others", "--exclude-standard", "-z"]
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("reuses a precreated checkpoint without creating another one", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-worker-"));
    const checkpointDir = join(workspace, ".runstead", "checkpoints");
    const gitCalls: string[][] = [];
    const runner: WorkerProcessRunner = () =>
      Promise.resolve({
        stdout: '{"summary":"done"}',
        stderr: "",
        exitCode: 0
      });

    try {
      const result = await startWrappedWorker({
        worker: "codex_cli",
        goal,
        task,
        workspace,
        evidenceDir: join(workspace, ".runstead", "evidence"),
        checkpointDir,
        checkpointBefore: {
          id: "chk_precreated",
          workspace,
          checkpointDir,
          metadataPath: join(checkpointDir, "chk_precreated.json"),
          statusPath: join(checkpointDir, "chk_precreated.status.txt"),
          patchPath: join(checkpointDir, "chk_precreated.patch"),
          untrackedDir: join(checkpointDir, "chk_precreated.untracked"),
          untrackedFiles: [],
          head: "abc123",
          createdAt: "2026-05-14T00:00:00.000Z"
        },
        checkpointRunner: (args) => {
          gitCalls.push(args);

          return Promise.resolve({
            stdout: "",
            stderr: "",
            exitCode: 0
          });
        },
        runner
      });

      expect(result.checkpointBefore?.id).toBe("chk_precreated");
      expect(gitCalls).toEqual([]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
