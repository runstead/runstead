import { resolveVerifierCommandOptions } from "../local-agent-verifier-options.js";
import type { ResolvedConfiguredLocalAgentPreset } from "../local-agent-presets.js";
import type { CommandVerifierInput } from "../verifier-evidence.js";

export interface ResolveAgentPresetVerifierOptions {
  cwd?: string;
  presetId: "fix:small" | "repair:test" | "test:triage";
  prompt: string;
  verifier: string[];
  commandName: string;
  missingVerifierMessage: string;
  discover?: (options: { cwd?: string }) => Promise<CommandVerifierInput[]>;
}

export interface ResolvedAgentPresetVerifierOptions {
  resolvedPreset: ResolvedConfiguredLocalAgentPreset;
  verifierCommands: CommandVerifierInput[];
}

export async function resolveAgentPresetVerifierOptions(
  options: ResolveAgentPresetVerifierOptions
): Promise<ResolvedAgentPresetVerifierOptions> {
  const { resolveConfiguredLocalAgentPreset } =
    await import("../local-agent-presets.js");
  let verifierCommands = await resolveVerifierCommandOptions(
    options.verifier,
    options.commandName,
    {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      required: false,
      ...(options.discover === undefined ? {} : { discover: options.discover })
    }
  );
  let resolvedPreset = await resolveConfiguredLocalAgentPreset(
    options.presetId,
    presetInput(options.prompt, verifierCommands),
    {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd })
    }
  );

  if (verifierCommands.length === 0 && resolvedPreset.verifierCommands !== undefined) {
    verifierCommands = resolvedPreset.verifierCommands;
    resolvedPreset = await resolveConfiguredLocalAgentPreset(
      options.presetId,
      presetInput(options.prompt, verifierCommands),
      {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      }
    );
  }

  if (verifierCommands.length === 0) {
    throw new Error(options.missingVerifierMessage);
  }

  return {
    resolvedPreset,
    verifierCommands
  };
}

function presetInput(
  prompt: string,
  verifierCommands: CommandVerifierInput[]
): {
  prompt?: string;
  verifierNames: string[];
} {
  return {
    ...(prompt.length === 0 ? {} : { prompt }),
    verifierNames: verifierCommands.map((command) => command.name)
  };
}
