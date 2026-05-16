import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Goal, Task } from "@runstead/core";
import { describe, expect, it } from "vitest";

import {
  buildWrappedWorkerLaunchGuardrails,
  buildWrappedWorkerGovernanceManifest,
  buildWrappedWorkerInternalToolProxyStatus,
  buildWrappedWorkerPrompt,
  runWorkerProcess,
  startWrappedWorker,
  WrappedWorkerHardProxyUnavailableError,
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

const wrappedWorkerOutput = JSON.stringify({
  summary: "done",
  files_changed: [],
  commands_run: [],
  risks: [],
  needs_approval: false,
  approval_reason: null
});

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
    expect(prompt).toContain('"internalToolProxy":');
    expect(prompt).toContain('"mode": "none"');
    expect(prompt).toContain("worker-native guardrails");
    expect(prompt).toContain("worker-internal tool calls are not fully hard-proxied");
    expect(prompt).toContain('"launchGuardrails":');
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
      capabilities: {
        launchPolicyGate: true,
        workerNativeGuardrails: true,
        workspaceCheckpoint: true,
        postRunDiffVerification: true,
        hardProxyToolCalls: false
      },
      internalToolProxy: {
        mode: "none",
        required: "none",
        hardProxyAvailable: false
      },
      enforcementNotes: [
        "Runstead policy-gates worker launch.",
        "Runstead starts wrapped workers with worker-native sandbox or permission guardrails.",
        "Runstead verifies diff scope and command evidence after the worker exits.",
        "Worker-internal tool calls are not fully hard-proxied in wrapper mode."
      ],
      allowedScope: ["src/**"],
      deniedActions: [".env"],
      approvalRequired: ["external writes"],
      verifierContract: ["test: pnpm test"],
      launchGuardrails: {
        worker: "codex_cli",
        sandboxMode: "workspace-write",
        disallowedTools: []
      }
    });
  });

  it("builds worker-native launch guardrails", () => {
    expect(buildWrappedWorkerLaunchGuardrails("codex_cli")).toEqual({
      worker: "codex_cli",
      sandboxMode: "workspace-write",
      disallowedTools: []
    });
    const claudeGuardrails = buildWrappedWorkerLaunchGuardrails("claude_code");

    expect(claudeGuardrails).toMatchObject({
      worker: "claude_code",
      permissionMode: "default"
    });
    expect(claudeGuardrails.disallowedTools).toEqual(
      expect.arrayContaining([
        "Bash(git push *)",
        "Bash(gh pr create *)",
        "Bash(pnpm add *)"
      ])
    );
  });

  it("fails closed when hard tool proxy enforcement is required", () => {
    expect(
      buildWrappedWorkerInternalToolProxyStatus({
        worker: "codex_cli",
        requiredInternalToolProxy: "none"
      })
    ).toEqual({
      mode: "none",
      required: "none",
      hardProxyAvailable: false
    });
    expect(() =>
      buildWrappedWorkerGovernanceManifest({
        worker: "codex_cli",
        goal,
        task,
        workspace: "/repo",
        evidenceDir: "/repo/.runstead/evidence",
        requiredInternalToolProxy: "hard_proxy"
      })
    ).toThrow(WrappedWorkerHardProxyUnavailableError);
  });
});

describe("workerCommand", () => {
  it("maps worker kinds to their CLI invocations", () => {
    expect(workerCommand("claude_code", "prompt")).toEqual({
      command: "claude",
      args: [
        "-p",
        "--permission-mode",
        "default",
        "--disallowedTools",
        expect.stringContaining("Bash(git push *)"),
        "--",
        "prompt"
      ]
    });
    expect(workerCommand("claude_code", "prompt", { model: "sonnet" })).toEqual({
      command: "claude",
      args: [
        "-p",
        "--model",
        "sonnet",
        "--permission-mode",
        "default",
        "--disallowedTools",
        expect.stringContaining("Bash(git push *)"),
        "--",
        "prompt"
      ]
    });
    expect(workerCommand("codex_cli", "prompt", { workspace: "/repo" })).toEqual({
      command: "codex",
      args: ["exec", "--sandbox", "workspace-write", "--cd", "/repo", "prompt"]
    });
    expect(
      workerCommand("codex_cli", "prompt", {
        workspace: "/repo",
        model: "gpt-5.5"
      })
    ).toEqual({
      command: "codex",
      args: [
        "exec",
        "--model",
        "gpt-5.5",
        "--sandbox",
        "workspace-write",
        "--cd",
        "/repo",
        "prompt"
      ]
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
        stdout: wrappedWorkerOutput,
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
      model: "gpt-5.5",
      runner
    });

    expect(result).toMatchObject({
      worker: "codex_cli",
      command: "codex",
      stdout: wrappedWorkerOutput,
      stderr: "",
      exitCode: 0
    });
    expect(result.outputValidation).toEqual({ valid: true });
    expect(result.structuredOutput).toMatchObject({
      summary: "done",
      needs_approval: false
    });
    expect(result.args[0]).toBe("exec");
    expect(result.args).toEqual([
      "exec",
      "--model",
      "gpt-5.5",
      "--sandbox",
      "workspace-write",
      "--cd",
      "/repo",
      result.prompt
    ]);
    expect(result.governance).toMatchObject({
      worker: "codex_cli",
      taskId: "task_ci_001",
      enforcement: "policy_gated_wrapper",
      internalToolProxy: {
        mode: "none",
        required: "none",
        hardProxyAvailable: false
      },
      launchGuardrails: {
        worker: "codex_cli",
        sandboxMode: "workspace-write"
      }
    });
    expect(calls).toEqual([
      {
        command: "codex",
        args: [
          "exec",
          "--model",
          "gpt-5.5",
          "--sandbox",
          "workspace-write",
          "--cd",
          "/repo",
          result.prompt
        ],
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
        stdout: wrappedWorkerOutput,
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
        stdout: wrappedWorkerOutput,
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

describe("runWorkerProcess", () => {
  it("runs workers with stdin ignored and captures stdout", async () => {
    const result = await runWorkerProcess(
      process.execPath,
      [
        "-e",
        [
          "process.stdin.resume();",
          "process.stdin.on('data', () => process.exit(2));",
          "process.stdin.on('end', () => console.log(JSON.stringify({ stdin: 'ignored' })));"
        ].join("")
      ],
      {
        cwd: process.cwd(),
        timeoutMs: 5_000,
        maxOutputBytes: 10_000
      }
    );

    expect(result).toEqual({
      stdout: '{"stdin":"ignored"}\n',
      stderr: "",
      exitCode: 0
    });
  });
});

describe("wrapped worker output validation", () => {
  it("fails an otherwise successful worker when stdout is empty", async () => {
    const result = await startWrappedWorker({
      worker: "codex_cli",
      goal,
      task,
      workspace: "/repo",
      evidenceDir: "/repo/.runstead/evidence",
      runner: () =>
        Promise.resolve({
          stdout: "",
          stderr: "",
          exitCode: 0
        })
    });

    expect(result.exitCode).toBe(1);
    expect(result.outputValidation).toEqual({
      valid: false,
      reason: "worker produced no structured output"
    });
    expect(result.stderr).toContain("[runstead] worker produced no structured output");
  });

  it("fails an otherwise successful worker when stdout is not contract JSON", async () => {
    const result = await startWrappedWorker({
      worker: "codex_cli",
      goal,
      task,
      workspace: "/repo",
      evidenceDir: "/repo/.runstead/evidence",
      runner: () =>
        Promise.resolve({
          stdout: '{"summary":"done"}',
          stderr: "",
          exitCode: 0
        })
    });

    expect(result.exitCode).toBe(1);
    expect(result.outputValidation).toEqual({
      valid: false,
      reason: "worker JSON output field files_changed is missing or invalid"
    });
    expect(result.stderr).toContain("files_changed is missing or invalid");
  });
});
