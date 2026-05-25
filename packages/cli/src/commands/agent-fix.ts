import type { Command } from "commander";

import {
  collectValues,
  parseCiRepairWorkerKind,
  parseRequiredPositiveInteger
} from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";
import { resolveVerifierCommandOptions } from "../local-agent-verifier-options.js";

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

export function registerAgentFixCommands(command: Command): void {
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
