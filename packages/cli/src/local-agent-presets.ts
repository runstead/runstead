import {
  loadLocalAgentPresetOverrides,
  mergePromptFocus
} from "./local-agent-preset-overrides.js";
import {
  LOCAL_AGENT_PRESETS,
  type LocalAgentPreset,
  type LocalAgentPresetInput
} from "./local-agent-preset-catalog.js";
import type { CommandVerifierInput } from "./verifier-evidence.js";

export { LOCAL_AGENT_PRESETS } from "./local-agent-preset-catalog.js";
export type {
  LocalAgentPreset,
  LocalAgentPresetInput,
  LocalAgentPresetMode,
  LocalAgentVerifierPolicy
} from "./local-agent-preset-catalog.js";

export interface ResolvedLocalAgentPreset {
  preset: LocalAgentPreset;
  prompt: string;
}

export interface ResolvedConfiguredLocalAgentPreset extends ResolvedLocalAgentPreset {
  model?: string;
  verifierCommands?: CommandVerifierInput[];
}

export function resolveLocalAgentPreset(
  id: string,
  input: LocalAgentPresetInput = {}
): ResolvedLocalAgentPreset {
  const preset = LOCAL_AGENT_PRESETS.find((candidate) => candidate.id === id);

  if (preset === undefined) {
    throw new Error(
      `Unknown local agent preset: ${id}. Available presets: ${localAgentPresetIds().join(", ")}`
    );
  }

  return {
    preset,
    prompt: preset.promptTemplate(input)
  };
}

export async function resolveConfiguredLocalAgentPreset(
  id: string,
  input: LocalAgentPresetInput = {},
  options: { cwd?: string } = {}
): Promise<ResolvedConfiguredLocalAgentPreset> {
  const override = (await loadLocalAgentPresetOverrides(options))[id];
  const prompt = mergePromptFocus(override?.promptFocus, input.prompt);
  const verifierNames =
    input.verifierNames ?? override?.verifierCommands?.map((command) => command.name);
  const presetInput: LocalAgentPresetInput = {
    ...input,
    ...(prompt === undefined ? {} : { prompt }),
    ...(verifierNames === undefined ? {} : { verifierNames })
  };
  const base = resolveLocalAgentPreset(id, presetInput);
  const preset =
    override === undefined
      ? base.preset
      : {
          ...base.preset,
          maxTurns: override.maxTurns ?? base.preset.maxTurns,
          maxToolCalls: override.maxToolCalls ?? base.preset.maxToolCalls,
          maxFailedToolCalls:
            override.maxFailedToolCalls ?? base.preset.maxFailedToolCalls
        };

  return {
    preset,
    prompt: preset.promptTemplate(presetInput),
    ...(override?.model === undefined ? {} : { model: override.model }),
    ...(override?.verifierCommands === undefined
      ? {}
      : { verifierCommands: override.verifierCommands })
  };
}

export function localAgentPresetIds(): string[] {
  return LOCAL_AGENT_PRESETS.map((preset) => preset.id);
}
