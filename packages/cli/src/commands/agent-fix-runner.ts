import { parseCiRepairWorkerKind } from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";
import { resolveVerifierCommandOptions } from "../local-agent-verifier-options.js";

import {
  agentBudgetTaskOptions,
  runAndReportLocalAgentTask
} from "./agent-budget-options.js";

export interface AgentFixCliOptions {
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

export async function runAgentFixLikeCommand(input: {
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

  const { attachLocalAgentVerifierEvidence, createLocalAgentTask } =
    await import("../local-agent.js");
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
    ...agentBudgetTaskOptions(input.options, {
      maxTurns: resolvedPreset.preset.maxTurns,
      maxToolCalls: resolvedPreset.preset.maxToolCalls,
      maxFailedToolCalls: resolvedPreset.preset.maxFailedToolCalls
    })
  });

  if (input.verifierFirst) {
    await attachLocalAgentVerifierEvidence({
      ...(input.options.cwd === undefined ? {} : { cwd: input.options.cwd }),
      taskId: created.task.id
    });
  }

  await runAndReportLocalAgentTask({
    ...(input.options.cwd === undefined ? {} : { cwd: input.options.cwd }),
    taskId: created.task.id
  });
}
