import { requireRbacPermission } from "../cli-rbac.js";
import {
  localAgentPresetRunsVerifiersFirst,
  resolvePresetVerifierCommandOptions
} from "../local-agent-verifier-options.js";

import {
  agentBudgetTaskOptions,
  runAndReportLocalAgentTask
} from "./agent-budget-options.js";
import {
  ALL_LOCAL_AGENT_WORKERS,
  parseAgentWorkerOption
} from "./agent-worker-options.js";

export interface AgentRunCliOptions {
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

export async function runAgentRunCommand(
  promptParts: string[],
  options: AgentRunCliOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "task.run",
    action: "run local agent tasks"
  });

  const worker = parseAgentWorkerOption({
    worker: options.worker,
    supported: ALL_LOCAL_AGENT_WORKERS,
    unsupportedMessage:
      "agent run currently supports --worker codex_direct, codex_cli, or claude_code"
  });

  const { attachLocalAgentVerifierEvidence, createLocalAgentTask } =
    await import("../local-agent.js");
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
        verifierNames: verifierCommands.map((item) => item.name)
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
    ...agentBudgetTaskOptions(
      options,
      resolvedPreset === undefined
        ? {}
        : {
            maxTurns: resolvedPreset.preset.maxTurns,
            maxToolCalls: resolvedPreset.preset.maxToolCalls,
            maxFailedToolCalls: resolvedPreset.preset.maxFailedToolCalls
          }
    )
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

  await runAndReportLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    taskId: created.task.id
  });
}

function parseLocalAgentMode(value: string): "read-only" | "edit" | "repair" {
  if (value === "read-only" || value === "edit" || value === "repair") {
    return value;
  }

  throw new Error("--mode must be read-only, edit, or repair");
}
