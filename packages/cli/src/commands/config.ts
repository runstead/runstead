import type { Command } from "commander";

interface ConfigCliOptions {
  cwd?: string;
}

export function registerConfigCommand(program: Command): Command {
  const config = program.command("config").description("Manage local config.");

  config
    .command("set")
    .description("Set a supported .runstead/config.yaml value.")
    .argument("<key>", "Config key, for example codex.model")
    .argument("<value>", "Config value")
    .option("--cwd <path>", "Workspace directory")
    .action(async (key: string, value: string, options: ConfigCliOptions) => {
      const { formatRunsteadConfigSetResult, setRunsteadConfigValue } =
        await import("../config.js");
      const result = await setRunsteadConfigValue({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        key,
        value
      });

      console.log(formatRunsteadConfigSetResult(result));
    });

  config
    .command("get")
    .description("Read a supported .runstead/config.yaml value.")
    .argument("<key>", "Config key, for example codex.model")
    .option("--cwd <path>", "Workspace directory")
    .action(async (key: string, options: ConfigCliOptions) => {
      const { readRunsteadConfigValue } = await import("../config.js");
      const value = await readRunsteadConfigValue({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        key
      });

      console.log(value ?? "");
    });

  return config;
}
