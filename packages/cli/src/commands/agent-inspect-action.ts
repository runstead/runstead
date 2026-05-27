import {
  parseCiRepairWorkerKind,
  parseRequiredPositiveInteger
} from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";

export interface AgentInspectCliOptions {
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

export async function runAgentInspectCommand(
  focusParts: string[],
  options: AgentInspectCliOptions
): Promise<void> {
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
