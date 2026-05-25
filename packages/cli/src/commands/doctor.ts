import type { Command } from "commander";

export function registerDoctorCommand(program: Command): Command {
  return program
    .command("doctor")
    .description("Check local Runstead state and scaffold health.")
    .option("--cwd <path>", "Workspace directory")
    .option("--codex", "Check local-agent worker readiness")
    .option(
      "--worker <worker>",
      "Worker to check: codex_direct, codex_cli, or claude_code"
    )
    .option("--model <model>", "Model to use for wrapped worker probes")
    .action(
      async (options: {
        cwd?: string;
        codex?: boolean;
        worker?: string;
        model?: string;
      }) => {
        const { doctorRunstead } = await import("../doctor.js");
        const worker =
          options.worker === undefined ? undefined : parseDoctorWorker(options.worker);
        const result = await doctorRunstead({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.codex === undefined ? {} : { codex: options.codex }),
          ...(worker === undefined ? {} : { worker }),
          ...(options.model === undefined ? {} : { model: options.model })
        });

        console.log(`Runstead doctor for ${result.root}`);

        for (const check of result.checks) {
          console.log(`[${check.status}] ${check.label}: ${check.message}`);
        }

        if (!result.ok) {
          process.exitCode = 1;
        }
      }
    );
}

function parseDoctorWorker(
  value: string
): "codex_direct" | "codex_cli" | "claude_code" {
  if (value === "codex_direct" || value === "codex_cli" || value === "claude_code") {
    return value;
  }

  throw new Error(
    "--worker must be codex_direct, codex_cli, or claude_code for doctor --codex"
  );
}
