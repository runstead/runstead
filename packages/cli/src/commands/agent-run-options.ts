import {
  localAgentPresetRunsVerifiersFirst,
  resolvePresetVerifierCommandOptions
} from "../local-agent-verifier-options.js";

import type { ResolvedConfiguredLocalAgentPreset } from "../local-agent-presets.js";
import type { CommandVerifierInput } from "../verifier-evidence.js";

export interface ResolveAgentRunPresetOptions {
  cwd?: string;
  preset?: string;
  prompt: string;
  verifier: string[];
}

export interface ResolvedAgentRunPresetOptions {
  resolvedPreset?: ResolvedConfiguredLocalAgentPreset;
  verifierCommands: CommandVerifierInput[];
  runPresetVerifiersFirst: boolean;
}

export async function resolveAgentRunPresetOptions(
  options: ResolveAgentRunPresetOptions
): Promise<ResolvedAgentRunPresetOptions> {
  const { resolveConfiguredLocalAgentPreset } =
    await import("../local-agent-presets.js");
  let resolvedPreset =
    options.preset === undefined
      ? undefined
      : await resolveConfiguredLocalAgentPreset(
          options.preset,
          {
            ...(options.prompt.length === 0 ? {} : { prompt: options.prompt })
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
        ...(options.prompt.length === 0 ? {} : { prompt: options.prompt }),
        verifierNames: verifierCommands.map((item) => item.name)
      },
      {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      }
    );
  }

  if (resolvedPreset === undefined && options.prompt.length === 0) {
    throw new Error("agent run prompt is required unless --preset is set");
  }

  return {
    ...(resolvedPreset === undefined ? {} : { resolvedPreset }),
    verifierCommands,
    runPresetVerifiersFirst:
      resolvedPreset !== undefined &&
      localAgentPresetRunsVerifiersFirst(resolvedPreset.preset.verifierPolicy)
  };
}

export function parseLocalAgentMode(value: string): "read-only" | "edit" | "repair" {
  if (value === "read-only" || value === "edit" || value === "repair") {
    return value;
  }

  throw new Error("--mode must be read-only, edit, or repair");
}
