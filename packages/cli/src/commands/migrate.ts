import type { Command } from "commander";

export function registerMigrateCommand(program: Command): Command {
  return program
    .command("migrate")
    .description("Migrate legacy .team state into .runstead.")
    .argument("[source]", "Source state directory", ".team")
    .argument("[destination]", "Destination state directory", ".runstead")
    .option("--cwd <path>", "Workspace directory")
    .option("--force", "Overwrite the destination if it exists")
    .action(
      async (
        source: string,
        destination: string,
        options: { cwd?: string; force?: boolean }
      ) => {
        const { migrateRunsteadState } = await import("../migrate.js");
        const result = await migrateRunsteadState({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          source,
          destination,
          ...(options.force === undefined ? {} : { force: options.force })
        });

        console.log(`Migrated ${result.source} -> ${result.destination}`);
        if (result.overwritten) {
          console.log("Destination overwritten.");
        }
      }
    );
}
