import type { Command } from "commander";

import {
  collectValues,
  parseCiRepairWorkerKind,
  parseRequiredPositiveInteger
} from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";
import {
  localAgentPresetRunsVerifiersFirst,
  resolvePresetVerifierCommandOptions,
  resolveVerifierCommandOptions
} from "../local-agent-verifier-options.js";
import { registerAgentLifecycleCommands } from "./agent-lifecycle.js";
import { registerAgentProvidersCommand } from "./agent-providers.js";

interface AgentRunCliOptions {
  cwd?: string;
  worker: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  mode: string;
  preset?: string;
  allowed: string[];
  denied: string[];
  verifier: string[];
  maxTurns?: string;
  maxToolCalls?: string;
  maxFailedToolCalls?: string;
  actor: string;
}

interface AgentInspectCliOptions {
  cwd?: string;
  worker: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  depth: string;
  maxTurns?: string;
  maxToolCalls?: string;
  maxFailedToolCalls?: string;
  actor: string;
}

interface AgentReviewCliOptions {
  cwd?: string;
  worker: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  staged?: boolean;
  base?: string;
  unpushed?: boolean;
  maxTurns?: string;
  maxToolCalls?: string;
  maxFailedToolCalls?: string;
  actor: string;
}

interface AgentTestCliOptions {
  cwd?: string;
  worker: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  verifier: string[];
  maxTurns?: string;
  maxToolCalls?: string;
  maxFailedToolCalls?: string;
  actor: string;
}

interface AgentFixCliOptions {
  cwd?: string;
  worker: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  allowed: string[];
  denied: string[];
  verifier: string[];
  maxTurns?: string;
  maxToolCalls?: string;
  maxFailedToolCalls?: string;
  actor: string;
}

export function registerAgentCommand(program: Command): Command {
  const command = program.command("agent").description("Run local repo agent tasks.");

  addAgentCommand(command);

  return command;
}

function addAgentCommand(command: Command): void {
  registerAgentProvidersCommand(command);

  command
    .command("run")
    .description("Run a governed local agent task against the current workspace.")
    .argument("[prompt...]", "Task prompt for the local agent")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--worker <worker>",
      "Worker to run: codex_direct, codex_cli, or claude_code",
      "codex_direct"
    )
    .option("--provider <provider>", "Model provider to use with codex_direct")
    .option(
      "--model <model>",
      "Model to use with codex_direct, codex_cli, or claude_code"
    )
    .option("--base-url <url>", "Model provider base URL")
    .option("--mode <mode>", "Agent mode: read-only, edit, or repair", "read-only")
    .option("--preset <id>", "Local agent preset id")
    .option("--allowed <pattern>", "Allowed workspace path pattern", collectValues, [])
    .option("--denied <pattern>", "Denied workspace path pattern", collectValues, [])
    .option(
      "--verifier <name=command>",
      "Verifier command for edit/repair tasks, or auto to discover common scripts",
      collectValues,
      []
    )
    .option("--max-turns <number>", "Maximum Codex Direct tool turns")
    .option("--max-tool-calls <number>", "Maximum Codex Direct tool calls")
    .option(
      "--max-failed-tool-calls <number>",
      "Maximum recoverable Codex Direct tool failures"
    )
    .option("--actor <id>", "RBAC subject for local agent execution", "local-admin")
    .action(async (promptParts: string[], options: AgentRunCliOptions) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "task.run",
        action: "run local agent tasks"
      });

      const worker = parseCiRepairWorkerKind(options.worker);

      if (
        worker !== "codex_direct" &&
        worker !== "codex_cli" &&
        worker !== "claude_code"
      ) {
        throw new Error(
          "agent run currently supports --worker codex_direct, codex_cli, or claude_code"
        );
      }

      const {
        attachLocalAgentVerifierEvidence,
        createLocalAgentTask,
        formatLocalAgentRunReport,
        localAgentRunExitCode,
        runLocalAgentTask
      } = await import("../local-agent.js");
      const { resolveConfiguredLocalAgentPreset } =
        await import("../local-agent-presets.js");
      const prompt = promptParts.join(" ").trim();
      let resolvedPreset =
        options.preset === undefined
          ? undefined
          : await resolveConfiguredLocalAgentPreset(
              options.preset,
              {
                ...(prompt.length === 0 ? {} : { prompt })
              },
              {
                ...(options.cwd === undefined ? {} : { cwd: options.cwd })
              }
            );

      const verifierCommands = await resolvePresetVerifierCommandOptions({
        values: options.verifier,
        commandName: "agent run",
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(resolvedPreset === undefined ? {} : { preset: resolvedPreset })
      });

      if (resolvedPreset !== undefined) {
        resolvedPreset = await resolveConfiguredLocalAgentPreset(
          resolvedPreset.preset.id,
          {
            ...(prompt.length === 0 ? {} : { prompt }),
            verifierNames: verifierCommands.map((command) => command.name)
          },
          {
            ...(options.cwd === undefined ? {} : { cwd: options.cwd })
          }
        );
      }

      if (resolvedPreset === undefined && prompt.length === 0) {
        throw new Error("agent run prompt is required unless --preset is set");
      }

      const model = options.model ?? resolvedPreset?.model;
      const created = await createLocalAgentTask({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        prompt: resolvedPreset?.prompt ?? prompt,
        ...(resolvedPreset === undefined
          ? {}
          : {
              preset: resolvedPreset.preset.id,
              checkpoint: resolvedPreset.preset.checkpoint
            }),
        worker,
        ...(options.provider === undefined ? {} : { provider: options.provider }),
        ...(model === undefined ? {} : { model }),
        ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
        mode:
          resolvedPreset === undefined
            ? parseLocalAgentMode(options.mode)
            : resolvedPreset.preset.mode,
        allowedPaths: options.allowed,
        deniedPaths: options.denied,
        verifierCommands,
        ...(options.maxTurns === undefined
          ? resolvedPreset === undefined
            ? {}
            : { maxTurns: resolvedPreset.preset.maxTurns }
          : {
              maxTurns: parseRequiredPositiveInteger(options.maxTurns, "--max-turns")
            }),
        ...(options.maxToolCalls === undefined
          ? resolvedPreset === undefined
            ? {}
            : { maxToolCalls: resolvedPreset.preset.maxToolCalls }
          : {
              maxToolCalls: parseRequiredPositiveInteger(
                options.maxToolCalls,
                "--max-tool-calls"
              )
            }),
        ...(options.maxFailedToolCalls === undefined
          ? resolvedPreset === undefined
            ? {}
            : { maxFailedToolCalls: resolvedPreset.preset.maxFailedToolCalls }
          : {
              maxFailedToolCalls: parseRequiredPositiveInteger(
                options.maxFailedToolCalls,
                "--max-failed-tool-calls"
              )
            })
      });

      if (
        resolvedPreset !== undefined &&
        localAgentPresetRunsVerifiersFirst(resolvedPreset.preset.verifierPolicy)
      ) {
        await attachLocalAgentVerifierEvidence({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          taskId: created.task.id
        });
      }

      const result = await runLocalAgentTask({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        taskId: created.task.id
      });
      const exitCode = localAgentRunExitCode(result);

      console.log(formatLocalAgentRunReport(result));
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });

  command
    .command("inspect")
    .description("Run a preset read-only repository inspection.")
    .argument("[focus...]", "Optional inspection focus")
    .option("--cwd <path>", "Workspace directory")
    .option("--worker <worker>", "Worker to run: codex_direct", "codex_direct")
    .option("--provider <provider>", "Model provider to use with codex_direct")
    .option("--model <model>", "Model to use with codex_direct")
    .option("--base-url <url>", "Model provider base URL")
    .option("--depth <depth>", "Inspection depth: smoke or standard", "smoke")
    .option("--max-turns <number>", "Override preset Codex Direct tool turns")
    .option("--max-tool-calls <number>", "Override preset Codex Direct tool calls")
    .option(
      "--max-failed-tool-calls <number>",
      "Override preset recoverable Codex Direct tool failures"
    )
    .option("--actor <id>", "RBAC subject for local agent execution", "local-admin")
    .action(async (focusParts: string[], options: AgentInspectCliOptions) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "task.run",
        action: "run local agent inspection"
      });

      const worker = parseCiRepairWorkerKind(options.worker);

      if (worker !== "codex_direct") {
        throw new Error("agent inspect currently supports --worker codex_direct only");
      }

      const {
        createLocalAgentTask,
        formatLocalAgentRunReport,
        localAgentRunExitCode,
        runLocalAgentTask
      } = await import("../local-agent.js");
      const { resolveConfiguredLocalAgentPreset } =
        await import("../local-agent-presets.js");
      const focus = focusParts.join(" ").trim();
      const resolvedPreset = await resolveConfiguredLocalAgentPreset(
        localAgentInspectPresetId(options.depth),
        focus.length === 0 ? {} : { prompt: focus },
        {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd })
        }
      );
      const model = options.model ?? resolvedPreset.model;
      const created = await createLocalAgentTask({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        prompt: resolvedPreset.prompt,
        preset: resolvedPreset.preset.id,
        title: `Local agent ${resolvedPreset.preset.id}`,
        worker,
        ...(options.provider === undefined ? {} : { provider: options.provider }),
        ...(model === undefined ? {} : { model }),
        ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
        mode: resolvedPreset.preset.mode,
        checkpoint: resolvedPreset.preset.checkpoint,
        ...(options.maxTurns === undefined
          ? { maxTurns: resolvedPreset.preset.maxTurns }
          : {
              maxTurns: parseRequiredPositiveInteger(options.maxTurns, "--max-turns")
            }),
        ...(options.maxToolCalls === undefined
          ? { maxToolCalls: resolvedPreset.preset.maxToolCalls }
          : {
              maxToolCalls: parseRequiredPositiveInteger(
                options.maxToolCalls,
                "--max-tool-calls"
              )
            }),
        ...(options.maxFailedToolCalls === undefined
          ? { maxFailedToolCalls: resolvedPreset.preset.maxFailedToolCalls }
          : {
              maxFailedToolCalls: parseRequiredPositiveInteger(
                options.maxFailedToolCalls,
                "--max-failed-tool-calls"
              )
            })
      });
      const result = await runLocalAgentTask({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        taskId: created.task.id
      });
      const exitCode = localAgentRunExitCode(result);

      console.log(formatLocalAgentRunReport(result));
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });

  command
    .command("review")
    .description("Run a preset read-only review of the current git diff.")
    .argument("[focus...]", "Optional review focus")
    .option("--cwd <path>", "Workspace directory")
    .option("--worker <worker>", "Worker to run: codex_direct", "codex_direct")
    .option("--provider <provider>", "Model provider to use with codex_direct")
    .option("--model <model>", "Model to use with codex_direct")
    .option("--base-url <url>", "Model provider base URL")
    .option("--staged", "Review the staged diff instead of the unstaged diff")
    .option("--base <ref>", "Review HEAD against a base ref")
    .option("--unpushed", "Review commits ahead of the upstream branch")
    .option("--max-turns <number>", "Override preset Codex Direct tool turns")
    .option("--max-tool-calls <number>", "Override preset Codex Direct tool calls")
    .option(
      "--max-failed-tool-calls <number>",
      "Override preset recoverable Codex Direct tool failures"
    )
    .option("--actor <id>", "RBAC subject for local agent execution", "local-admin")
    .action(async (focusParts: string[], options: AgentReviewCliOptions) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "task.run",
        action: "run local agent review"
      });

      const worker = parseCiRepairWorkerKind(options.worker);

      if (worker !== "codex_direct") {
        throw new Error("agent review currently supports --worker codex_direct only");
      }

      assertSingleReviewScope(options);

      const {
        createLocalAgentTask,
        formatLocalAgentRunReport,
        localAgentRunExitCode,
        runLocalAgentTask
      } = await import("../local-agent.js");
      const { resolveConfiguredLocalAgentPreset } =
        await import("../local-agent-presets.js");
      const focus = focusParts.join(" ").trim();
      const scope = localAgentReviewScope(options);
      const gitDiffBase =
        scope.kind === "base"
          ? scope.base
          : scope.kind === "unpushed"
            ? "@{upstream}"
            : undefined;
      const resolvedPreset = await resolveConfiguredLocalAgentPreset(
        scope.kind === "staged"
          ? "review:staged"
          : scope.kind === "unpushed"
            ? "review:unpushed"
            : "review:diff",
        {
          prompt: [
            scope.prompt,
            scope.gitDiffInstruction,
            ...(focus.length === 0 ? [] : [focus])
          ].join("\n")
        },
        {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd })
        }
      );
      const model = options.model ?? resolvedPreset.model;
      const created = await createLocalAgentTask({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        prompt: resolvedPreset.prompt,
        preset: resolvedPreset.preset.id,
        title: `Local agent review ${scope.title}`,
        worker,
        ...(options.provider === undefined ? {} : { provider: options.provider }),
        ...(model === undefined ? {} : { model }),
        ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
        mode: resolvedPreset.preset.mode,
        checkpoint: resolvedPreset.preset.checkpoint,
        gitDiffStaged: options.staged === true,
        ...(gitDiffBase === undefined ? {} : { gitDiffBase }),
        ...(options.maxTurns === undefined
          ? { maxTurns: resolvedPreset.preset.maxTurns }
          : {
              maxTurns: parseRequiredPositiveInteger(options.maxTurns, "--max-turns")
            }),
        ...(options.maxToolCalls === undefined
          ? { maxToolCalls: resolvedPreset.preset.maxToolCalls }
          : {
              maxToolCalls: parseRequiredPositiveInteger(
                options.maxToolCalls,
                "--max-tool-calls"
              )
            }),
        ...(options.maxFailedToolCalls === undefined
          ? { maxFailedToolCalls: resolvedPreset.preset.maxFailedToolCalls }
          : {
              maxFailedToolCalls: parseRequiredPositiveInteger(
                options.maxFailedToolCalls,
                "--max-failed-tool-calls"
              )
            })
      });
      const result = await runLocalAgentTask({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        taskId: created.task.id
      });
      const exitCode = localAgentRunExitCode(result);

      console.log(formatLocalAgentRunReport(result));
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });

  command
    .command("test")
    .description("Run verifiers first, then triage the evidence with Codex Direct.")
    .argument("[focus...]", "Optional test triage focus")
    .option("--cwd <path>", "Workspace directory")
    .option("--worker <worker>", "Worker to run: codex_direct", "codex_direct")
    .option("--provider <provider>", "Model provider to use with codex_direct")
    .option("--model <model>", "Model to use with codex_direct")
    .option("--base-url <url>", "Model provider base URL")
    .option(
      "--verifier <name=command>",
      "Verifier command to run before triage, or auto to discover common scripts",
      collectValues,
      []
    )
    .option("--max-turns <number>", "Override preset Codex Direct tool turns")
    .option("--max-tool-calls <number>", "Override preset Codex Direct tool calls")
    .option(
      "--max-failed-tool-calls <number>",
      "Override preset recoverable Codex Direct tool failures"
    )
    .option("--actor <id>", "RBAC subject for local agent execution", "local-admin")
    .action(async (focusParts: string[], options: AgentTestCliOptions) => {
      let verifierCommands = await resolveVerifierCommandOptions(
        options.verifier,
        "agent test",
        {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          required: false
        }
      );

      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "task.run",
        action: "run local agent test triage"
      });

      const worker = parseCiRepairWorkerKind(options.worker);

      if (worker !== "codex_direct") {
        throw new Error("agent test currently supports --worker codex_direct only");
      }

      const {
        attachLocalAgentVerifierEvidence,
        createLocalAgentTask,
        formatLocalAgentRunReport,
        localAgentRunExitCode,
        runLocalAgentTask
      } = await import("../local-agent.js");
      const { resolveConfiguredLocalAgentPreset } =
        await import("../local-agent-presets.js");
      const focus = focusParts.join(" ").trim();
      let resolvedPreset = await resolveConfiguredLocalAgentPreset(
        "test:triage",
        {
          ...(focus.length === 0 ? {} : { prompt: focus }),
          verifierNames: verifierCommands.map((command) => command.name)
        },
        {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd })
        }
      );

      if (
        verifierCommands.length === 0 &&
        resolvedPreset.verifierCommands !== undefined
      ) {
        verifierCommands = resolvedPreset.verifierCommands;
        resolvedPreset = await resolveConfiguredLocalAgentPreset(
          "test:triage",
          {
            ...(focus.length === 0 ? {} : { prompt: focus }),
            verifierNames: verifierCommands.map((command) => command.name)
          },
          {
            ...(options.cwd === undefined ? {} : { cwd: options.cwd })
          }
        );
      }

      if (verifierCommands.length === 0) {
        throw new Error(
          "agent test requires at least one --verifier name=command, --verifier auto, or preset verifier"
        );
      }
      const model = options.model ?? resolvedPreset.model;
      const created = await createLocalAgentTask({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        prompt: resolvedPreset.prompt,
        preset: resolvedPreset.preset.id,
        title: "Local agent test triage",
        worker,
        ...(options.provider === undefined ? {} : { provider: options.provider }),
        ...(model === undefined ? {} : { model }),
        ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
        mode: resolvedPreset.preset.mode,
        checkpoint: resolvedPreset.preset.checkpoint,
        verifierCommands,
        ...(options.maxTurns === undefined
          ? { maxTurns: resolvedPreset.preset.maxTurns }
          : {
              maxTurns: parseRequiredPositiveInteger(options.maxTurns, "--max-turns")
            }),
        ...(options.maxToolCalls === undefined
          ? { maxToolCalls: resolvedPreset.preset.maxToolCalls }
          : {
              maxToolCalls: parseRequiredPositiveInteger(
                options.maxToolCalls,
                "--max-tool-calls"
              )
            }),
        ...(options.maxFailedToolCalls === undefined
          ? { maxFailedToolCalls: resolvedPreset.preset.maxFailedToolCalls }
          : {
              maxFailedToolCalls: parseRequiredPositiveInteger(
                options.maxFailedToolCalls,
                "--max-failed-tool-calls"
              )
            })
      });

      await attachLocalAgentVerifierEvidence({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        taskId: created.task.id
      });

      const result = await runLocalAgentTask({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        taskId: created.task.id
      });
      const exitCode = localAgentRunExitCode(result);

      console.log(formatLocalAgentRunReport(result));
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });

  command
    .command("fix")
    .description("Run a checkpointed small-fix agent task with required verifiers.")
    .argument("<prompt...>", "Fix prompt for the local agent")
    .option("--cwd <path>", "Workspace directory")
    .option("--worker <worker>", "Worker to run: codex_direct", "codex_direct")
    .option("--provider <provider>", "Model provider to use with codex_direct")
    .option("--model <model>", "Model to use with codex_direct")
    .option("--base-url <url>", "Model provider base URL")
    .option("--allowed <pattern>", "Allowed workspace path pattern", collectValues, [])
    .option("--denied <pattern>", "Denied workspace path pattern", collectValues, [])
    .option(
      "--verifier <name=command>",
      "Verifier command to run after the fix, or auto to discover common scripts",
      collectValues,
      []
    )
    .option("--max-turns <number>", "Override preset Codex Direct tool turns")
    .option("--max-tool-calls <number>", "Override preset Codex Direct tool calls")
    .option(
      "--max-failed-tool-calls <number>",
      "Override preset recoverable Codex Direct tool failures"
    )
    .option("--actor <id>", "RBAC subject for local agent execution", "local-admin")
    .action(async (promptParts: string[], options: AgentFixCliOptions) => {
      await runAgentFixLikeCommand({
        prompt: promptParts.join(" ").trim(),
        presetId: "fix:small",
        title: "Local agent small fix",
        action: "run local agent fix",
        verifierFirst: false,
        options
      });
    });

  command
    .command("repair-test")
    .description("Run verifier-first checkpointed repair for a failing local test.")
    .argument("[focus...]", "Optional repair focus")
    .option("--cwd <path>", "Workspace directory")
    .option("--worker <worker>", "Worker to run: codex_direct", "codex_direct")
    .option("--provider <provider>", "Model provider to use with codex_direct")
    .option("--model <model>", "Model to use with codex_direct")
    .option("--base-url <url>", "Model provider base URL")
    .option("--allowed <pattern>", "Allowed workspace path pattern", collectValues, [])
    .option("--denied <pattern>", "Denied workspace path pattern", collectValues, [])
    .option(
      "--verifier <name=command>",
      "Verifier command to run before and after repair, or auto to discover common scripts",
      collectValues,
      []
    )
    .option("--max-turns <number>", "Override preset Codex Direct tool turns")
    .option("--max-tool-calls <number>", "Override preset Codex Direct tool calls")
    .option(
      "--max-failed-tool-calls <number>",
      "Override preset recoverable Codex Direct tool failures"
    )
    .option("--actor <id>", "RBAC subject for local agent execution", "local-admin")
    .action(async (focusParts: string[], options: AgentFixCliOptions) => {
      await runAgentFixLikeCommand({
        prompt: focusParts.join(" ").trim(),
        presetId: "repair:test",
        title: "Local agent test repair",
        action: "run local agent test repair",
        verifierFirst: true,
        options
      });
    });

  registerAgentLifecycleCommands(command);
}

async function runAgentFixLikeCommand(input: {
  prompt: string;
  presetId: "fix:small" | "repair:test";
  title: string;
  action: string;
  verifierFirst: boolean;
  options: AgentFixCliOptions;
}): Promise<void> {
  let verifierCommands = await resolveVerifierCommandOptions(
    input.options.verifier,
    `agent ${input.presetId === "fix:small" ? "fix" : "repair-test"}`,
    {
      ...(input.options.cwd === undefined ? {} : { cwd: input.options.cwd }),
      required: false
    }
  );

  await requireRbacPermission({
    ...(input.options.cwd === undefined ? {} : { cwd: input.options.cwd }),
    actor: input.options.actor,
    permission: "task.run",
    action: input.action
  });

  const worker = parseCiRepairWorkerKind(input.options.worker);

  if (worker !== "codex_direct") {
    throw new Error(`${input.presetId} currently supports --worker codex_direct only`);
  }

  if (input.presetId === "fix:small" && input.prompt.length === 0) {
    throw new Error("agent fix prompt is required");
  }

  const {
    attachLocalAgentVerifierEvidence,
    createLocalAgentTask,
    formatLocalAgentRunReport,
    localAgentRunExitCode,
    runLocalAgentTask
  } = await import("../local-agent.js");
  const { resolveConfiguredLocalAgentPreset } =
    await import("../local-agent-presets.js");
  let resolvedPreset = await resolveConfiguredLocalAgentPreset(
    input.presetId,
    {
      ...(input.prompt.length === 0 ? {} : { prompt: input.prompt }),
      verifierNames: verifierCommands.map((command) => command.name)
    },
    {
      ...(input.options.cwd === undefined ? {} : { cwd: input.options.cwd })
    }
  );

  if (verifierCommands.length === 0 && resolvedPreset.verifierCommands !== undefined) {
    verifierCommands = resolvedPreset.verifierCommands;
    resolvedPreset = await resolveConfiguredLocalAgentPreset(
      input.presetId,
      {
        ...(input.prompt.length === 0 ? {} : { prompt: input.prompt }),
        verifierNames: verifierCommands.map((command) => command.name)
      },
      {
        ...(input.options.cwd === undefined ? {} : { cwd: input.options.cwd })
      }
    );
  }

  if (verifierCommands.length === 0) {
    throw new Error(
      `agent ${input.presetId === "fix:small" ? "fix" : "repair-test"} requires at least one --verifier name=command, --verifier auto, or preset verifier`
    );
  }
  const model = input.options.model ?? resolvedPreset.model;
  const created = await createLocalAgentTask({
    ...(input.options.cwd === undefined ? {} : { cwd: input.options.cwd }),
    prompt: resolvedPreset.prompt,
    preset: resolvedPreset.preset.id,
    title: input.title,
    worker,
    ...(input.options.provider === undefined
      ? {}
      : { provider: input.options.provider }),
    ...(model === undefined ? {} : { model }),
    ...(input.options.baseUrl === undefined ? {} : { baseUrl: input.options.baseUrl }),
    mode: resolvedPreset.preset.mode,
    checkpoint: resolvedPreset.preset.checkpoint,
    allowedPaths: input.options.allowed,
    deniedPaths: input.options.denied,
    verifierCommands,
    ...(input.options.maxTurns === undefined
      ? { maxTurns: resolvedPreset.preset.maxTurns }
      : {
          maxTurns: parseRequiredPositiveInteger(input.options.maxTurns, "--max-turns")
        }),
    ...(input.options.maxToolCalls === undefined
      ? { maxToolCalls: resolvedPreset.preset.maxToolCalls }
      : {
          maxToolCalls: parseRequiredPositiveInteger(
            input.options.maxToolCalls,
            "--max-tool-calls"
          )
        }),
    ...(input.options.maxFailedToolCalls === undefined
      ? { maxFailedToolCalls: resolvedPreset.preset.maxFailedToolCalls }
      : {
          maxFailedToolCalls: parseRequiredPositiveInteger(
            input.options.maxFailedToolCalls,
            "--max-failed-tool-calls"
          )
        })
  });

  if (input.verifierFirst) {
    await attachLocalAgentVerifierEvidence({
      ...(input.options.cwd === undefined ? {} : { cwd: input.options.cwd }),
      taskId: created.task.id
    });
  }

  const result = await runLocalAgentTask({
    ...(input.options.cwd === undefined ? {} : { cwd: input.options.cwd }),
    taskId: created.task.id
  });
  const exitCode = localAgentRunExitCode(result);

  console.log(formatLocalAgentRunReport(result));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

function parseLocalAgentMode(value: string): "read-only" | "edit" | "repair" {
  if (value === "read-only" || value === "edit" || value === "repair") {
    return value;
  }

  throw new Error("--mode must be read-only, edit, or repair");
}

function localAgentInspectPresetId(
  value: string
): "inspect:smoke" | "inspect:standard" {
  if (value === "smoke") {
    return "inspect:smoke";
  }
  if (value === "standard") {
    return "inspect:standard";
  }

  throw new Error("--depth must be smoke or standard");
}

function assertSingleReviewScope(options: AgentReviewCliOptions): void {
  const scopes = [
    options.staged === true,
    options.base !== undefined,
    options.unpushed === true
  ].filter(Boolean);

  if (scopes.length > 1) {
    throw new Error("agent review accepts only one of --staged, --base, or --unpushed");
  }
}

function localAgentReviewScope(options: AgentReviewCliOptions):
  | {
      kind: "staged" | "unstaged" | "unpushed";
      title: string;
      prompt: string;
      gitDiffInstruction: string;
    }
  | {
      kind: "base";
      base: string;
      title: string;
      prompt: string;
      gitDiffInstruction: string;
    } {
  if (options.staged === true) {
    return {
      kind: "staged",
      title: "staged diff",
      prompt: "Review the staged git diff only.",
      gitDiffInstruction: "When calling git_diff, pass staged=true."
    };
  }

  if (options.unpushed === true) {
    return {
      kind: "unpushed",
      title: "unpushed commits",
      prompt: "Review commits ahead of the upstream branch only.",
      gitDiffInstruction:
        "When calling git_diff, pass base='@{upstream}' and leave staged unset."
    };
  }

  if (options.base !== undefined) {
    return {
      kind: "base",
      base: options.base,
      title: `${options.base}...HEAD`,
      prompt: `Review the git diff from ${options.base} to HEAD only.`,
      gitDiffInstruction: `When calling git_diff, pass base='${options.base}' and leave staged unset.`
    };
  }

  return {
    kind: "unstaged",
    title: "unstaged diff",
    prompt: "Review the unstaged git diff only.",
    gitDiffInstruction: "When calling git_diff, leave staged unset or false."
  };
}
