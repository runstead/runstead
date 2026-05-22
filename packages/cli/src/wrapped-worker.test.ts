import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Goal, Task } from "@runstead/core";
import { describe, expect, it } from "vitest";

import {
  buildWrappedWorkerLaunchGuardrails,
  buildWrappedWorkerGovernanceManifest,
  buildWrappedWorkerInternalToolProxyStatus,
  buildWrappedWorkerPrompt,
  formatWorkerProcessProgress,
  runWorkerProcess,
  startWrappedWorker,
  WrappedWorkerHardProxyUnavailableError,
  workerCommand,
  type WorkerProcessProgress,
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
        "--output-format",
        "json",
        "--json-schema",
        expect.stringContaining('"summary"'),
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
        "--output-format",
        "json",
        "--json-schema",
        expect.stringContaining('"summary"'),
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
      env: { CODEX_HOME: "/codex-home" },
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

  it("runs Codex CLI with an isolated runtime profile by default", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-worker-runtime-"));
    const sourceCodexHome = join(workspace, "source-codex-home");
    const workerRuntimeDir = join(workspace, ".runstead", "worker-profiles");
    const previousCodexHome = process.env.CODEX_HOME;
    const calls: {
      env?: Record<string, string>;
    }[] = [];
    const runner: WorkerProcessRunner = (_command, _args, options) => {
      calls.push({
        ...(options.env === undefined ? {} : { env: options.env })
      });

      return Promise.resolve({
        stdout: wrappedWorkerOutput,
        stderr: "",
        exitCode: 0
      });
    };

    try {
      await mkdir(sourceCodexHome, { recursive: true });
      await writeFile(join(sourceCodexHome, "auth.json"), '{"token":"redacted"}\n');
      await writeFile(
        join(sourceCodexHome, "config.toml"),
        "mcp_servers = { inherited = true }\n"
      );
      process.env.CODEX_HOME = sourceCodexHome;

      await startWrappedWorker({
        worker: "codex_cli",
        goal,
        task,
        workspace,
        evidenceDir: join(workspace, ".runstead", "evidence"),
        workerRuntimeDir,
        runner
      });

      const isolatedHome = join(workerRuntimeDir, "codex-cli");

      expect(calls[0]?.env).toMatchObject({
        CODEX_HOME: isolatedHome,
        RUNSTEAD_WRAPPED_WORKER_PROFILE: "isolated-codex-cli"
      });
      await expect(readFile(join(isolatedHome, "auth.json"), "utf8")).resolves.toBe(
        '{"token":"redacted"}\n'
      );
      await expect(
        readFile(join(isolatedHome, "config.toml"), "utf8")
      ).rejects.toThrow();
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("passes progress reporting options to the process runner", async () => {
    const observedProgress: WorkerProcessProgress[] = [];
    const onProgress = (progress: WorkerProcessProgress): void => {
      observedProgress.push(progress);
    };
    const calls: {
      progressIntervalMs?: number;
      onProgress?: (progress: WorkerProcessProgress) => void;
    }[] = [];
    const runner: WorkerProcessRunner = (_command, _args, options) => {
      calls.push({
        ...(options.progressIntervalMs === undefined
          ? {}
          : { progressIntervalMs: options.progressIntervalMs }),
        ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress })
      });

      return Promise.resolve({
        stdout: wrappedWorkerOutput,
        stderr: "",
        exitCode: 0
      });
    };

    await startWrappedWorker({
      worker: "codex_cli",
      goal,
      task,
      workspace: "/repo",
      evidenceDir: "/repo/.runstead/evidence",
      env: { CODEX_HOME: "/codex-home" },
      progressIntervalMs: 123,
      onProgress,
      runner
    });

    expect(calls).toEqual([
      {
        progressIntervalMs: 123,
        onProgress
      }
    ]);
  });

  it("respects an explicitly supplied Codex CLI home", async () => {
    const calls: { env?: Record<string, string> }[] = [];
    const runner: WorkerProcessRunner = (_command, _args, options) => {
      calls.push({
        ...(options.env === undefined ? {} : { env: options.env })
      });

      return Promise.resolve({
        stdout: wrappedWorkerOutput,
        stderr: "",
        exitCode: 0
      });
    };

    await startWrappedWorker({
      worker: "codex_cli",
      goal,
      task,
      workspace: "/repo",
      evidenceDir: "/repo/.runstead/evidence",
      env: { CODEX_HOME: "/explicit-codex-home" },
      runner
    });

    expect(calls[0]?.env).toEqual({ CODEX_HOME: "/explicit-codex-home" });
  });

  it("validates Claude Code JSON envelope structured output", async () => {
    const structuredOutput = {
      summary: "done through claude",
      files_changed: [],
      commands_run: [],
      risks: [],
      needs_approval: false,
      approval_reason: null
    };
    const runner: WorkerProcessRunner = () =>
      Promise.resolve({
        stdout: JSON.stringify({
          type: "result",
          subtype: "success",
          result: "",
          structured_output: structuredOutput
        }),
        stderr: "",
        exitCode: 0
      });

    const result = await startWrappedWorker({
      worker: "claude_code",
      goal,
      task,
      workspace: "/repo",
      evidenceDir: "/repo/.runstead/evidence",
      model: "sonnet",
      runner
    });

    expect(result.outputValidation).toEqual({ valid: true });
    expect(result.structuredOutput).toEqual(structuredOutput);
    expect(result.args).toEqual([
      "-p",
      "--model",
      "sonnet",
      "--output-format",
      "json",
      "--json-schema",
      expect.stringContaining('"summary"'),
      "--permission-mode",
      "default",
      "--disallowedTools",
      expect.stringContaining("Bash(git push *)"),
      "--",
      result.prompt
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

  it("emits progress while a worker process is still running", async () => {
    const progress: WorkerProcessProgress[] = [];

    const result = await runWorkerProcess(
      process.execPath,
      ["-e", "setTimeout(() => console.log('done'), 60);"],
      {
        cwd: process.cwd(),
        timeoutMs: 5_000,
        maxOutputBytes: 10_000,
        progressIntervalMs: 10,
        onProgress: (item) => {
          progress.push(item);
        }
      }
    );

    expect(result).toEqual({
      stdout: "done\n",
      stderr: "",
      exitCode: 0
    });
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0]).toMatchObject({
      command: process.execPath
    });
    expect(progress[0]?.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("formats worker progress as a concise CLI heartbeat", () => {
    expect(
      formatWorkerProcessProgress({
        command: "codex",
        elapsedMs: 65_000,
        stdoutBytes: 5,
        stderrBytes: 7,
        capturedBytes: 12,
        workspaceChangedFiles: 2,
        workspaceRecentFiles: ["src/app.ts", "package.json"]
      })
    ).toBe(
      "[runstead] wrapped worker still running: codex elapsed=1m5s stdout=5B stderr=7B files=2 recent=src/app.ts,package.json"
    );
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
      env: { CODEX_HOME: "/codex-home" },
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
      env: { CODEX_HOME: "/codex-home" },
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
