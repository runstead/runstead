import type { LocalAgentVerifierPolicy } from "./local-agent-presets.js";
import type { CommandVerifierInput } from "./verifier-evidence.js";
import { parseVerifierCommandOption } from "./verifier-command-options.js";

export async function resolveVerifierCommandOptions(
  values: string[],
  commandName: string,
  options: {
    cwd?: string;
    required: boolean;
    discover?: (options: { cwd?: string }) => Promise<CommandVerifierInput[]>;
  }
): Promise<CommandVerifierInput[]> {
  const autoRequested = values.some((value) => value.trim() === "auto");
  const manual = values
    .filter((value) => value.trim() !== "auto")
    .map(parseVerifierCommandOption);
  const discovered = autoRequested
    ? await (options.discover ?? discoverVerifierCommandOptions)({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      })
    : [];
  const commands = mergeVerifierCommands([...discovered, ...manual]);

  if (commands.length === 0 && autoRequested) {
    throw new Error(
      `${commandName} could not discover verifier commands; pass --verifier name=command`
    );
  }

  if (commands.length === 0 && options.required) {
    throw new Error(
      `${commandName} requires at least one --verifier name=command or --verifier auto`
    );
  }

  return commands;
}

export async function resolvePresetVerifierCommandOptions(input: {
  values: string[];
  commandName: string;
  cwd?: string;
  preset?: {
    preset: {
      id: string;
      verifierPolicy: LocalAgentVerifierPolicy;
    };
    verifierCommands?: CommandVerifierInput[];
  };
  discover?: (options: { cwd?: string }) => Promise<CommandVerifierInput[]>;
}): Promise<CommandVerifierInput[]> {
  const explicit = await resolveVerifierCommandOptions(
    input.values,
    input.commandName,
    {
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      required: false,
      ...(input.discover === undefined ? {} : { discover: input.discover })
    }
  );

  if (explicit.length > 0 || input.preset === undefined) {
    return explicit;
  }

  if (
    input.preset.verifierCommands !== undefined &&
    input.preset.verifierCommands.length > 0
  ) {
    return input.preset.verifierCommands;
  }

  if (input.preset.preset.verifierPolicy === "auto") {
    return resolveVerifierCommandOptions(["auto"], input.commandName, {
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      required: false,
      ...(input.discover === undefined ? {} : { discover: input.discover })
    });
  }

  if (input.preset.preset.verifierPolicy === "required") {
    throw new Error(
      `${input.commandName} preset ${input.preset.preset.id} requires at least one --verifier name=command, --verifier auto, or preset verifier`
    );
  }

  return [];
}

export function localAgentPresetRunsVerifiersFirst(
  policy: LocalAgentVerifierPolicy
): boolean {
  return policy === "required";
}

async function discoverVerifierCommandOptions(options: {
  cwd?: string;
}): Promise<CommandVerifierInput[]> {
  const { discoverVerifierCommands } = await import("./verifier-discovery.js");

  return discoverVerifierCommands(options);
}

function mergeVerifierCommands(
  commands: CommandVerifierInput[]
): CommandVerifierInput[] {
  const merged = new Map<string, CommandVerifierInput>();

  for (const command of commands) {
    merged.set(command.name, command);
  }

  return [...merged.values()];
}
