import type { Command } from "commander";

import { parseRequiredPositiveInteger } from "../cli-parsers.js";

export function registerOpsCommand(program: Command): Command {
  const ops = program
    .command("ops")
    .description("Inspect Runstead control-plane operations.");

  ops
    .command("diagnostics")
    .description(
      "Generate a local diagnostics bundle with doctor, daemon, state, artifact, lock, and retention data."
    )
    .option("--cwd <path>", "Workspace directory")
    .option("--retention-days <days>", "Retention window for cleanup planning", "30")
    .option("--no-state-backup", "Do not copy state.db into the diagnostics directory")
    .action(
      async (options: {
        cwd?: string;
        retentionDays: string;
        stateBackup?: boolean;
      }) => {
        const { generateOpsDiagnosticsBundle } = await import("../ops-diagnostics.js");
        const result = await generateOpsDiagnosticsBundle({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          retentionDays: parseRequiredPositiveInteger(
            options.retentionDays,
            "--retention-days"
          ),
          includeStateBackup: options.stateBackup !== false
        });

        console.log(`Generated ops diagnostics: ${result.markdownPath}`);
        console.log(`JSON: ${result.jsonPath}`);
        console.log(`State backup: ${result.stateBackupPath ?? "skipped"}`);
        console.log(`Doctor: ${result.summary.doctorOk ? "ok" : "failed"}`);
        console.log(
          `Cleanup candidates: ${result.summary.retention.cleanupCandidates.length}`
        );
      }
    );

  return ops;
}
