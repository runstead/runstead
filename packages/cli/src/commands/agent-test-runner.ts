import { requireRbacPermission } from "../cli-rbac.js";
import { resolveVerifierCommandOptions } from "../local-agent-verifier-options.js";

import {
  agentBudgetTaskOptions,
  runAndReportLocalAgentTask
} from "./agent-budget-options.js";
import {
  CODEX_DIRECT_AGENT_WORKERS,
  parseAgentWorkerOption
} from "./agent-worker-options.js";

export interface AgentTestCliOptions {
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

export async function runAgentTestCommand(
  focusParts: string[],
  options: AgentTestCliOptions
): Promise<void> {
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

  const worker = parseAgentWorkerOption({
    worker: options.worker,
    supported: CODEX_DIRECT_AGENT_WORKERS,
    unsupportedMessage: "agent test currently supports --worker codex_direct only"
  });

  const { attachLocalAgentVerifierEvidence, createLocalAgentTask } =
    await import("../local-agent.js");
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

  if (verifierCommands.length === 0 && resolvedPreset.verifierCommands !== undefined) {
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
    ...agentBudgetTaskOptions(options, {
      maxTurns: resolvedPreset.preset.maxTurns,
      maxToolCalls: resolvedPreset.preset.maxToolCalls,
      maxFailedToolCalls: resolvedPreset.preset.maxFailedToolCalls
    })
  });

  await attachLocalAgentVerifierEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    taskId: created.task.id
  });

  await runAndReportLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    taskId: created.task.id
  });
}
