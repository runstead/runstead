import { join } from "node:path";

import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { requireUnmanagedHelperAcknowledgement } from "../cli-unmanaged.js";

export function registerCheckpointCommand(program: Command): Command {
  const checkpoint = program
    .command("checkpoint")
    .description("Manage workspace checkpoints and rollback.");

  checkpoint
    .command("restore")
    .description(
      "Restore workspace files from a checkpoint. Unmanaged helper; governed restores run through CI repair rollback."
    )
    .argument("<id>", "Checkpoint id")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--allow-head-mismatch",
      "Restore even when the current HEAD differs from the checkpoint HEAD"
    )
    .option("--actor <id>", "RBAC subject for checkpoint restore", "local-admin")
    .option("--unmanaged", "Acknowledge this helper bypasses governed runtime")
    .action(
      async (
        id: string,
        options: {
          cwd?: string;
          allowHeadMismatch?: boolean;
          actor: string;
          unmanaged?: boolean;
        }
      ) => {
        requireUnmanagedHelperAcknowledgement(options, "restore checkpoints");
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "repo.manage",
          action: "restore checkpoints"
        });

        const {
          formatWorkspaceCheckpointRestoreReport,
          recordWorkspaceCheckpointRestoreEvent,
          restoreWorkspaceCheckpoint
        } = await import("../checkpoints.js");
        const { requireRunsteadRoot } = await import("../runstead-root.js");
        const resolved = await requireRunsteadRoot(options.cwd);
        const result = await restoreWorkspaceCheckpoint({
          workspace: resolved.cwd,
          checkpointDir: join(resolved.root, "checkpoints"),
          checkpointId: id,
          allowHeadMismatch: options.allowHeadMismatch === true
        });
        recordWorkspaceCheckpointRestoreEvent({
          stateDb: join(resolved.root, "state.db"),
          result,
          actor: options.actor
        });

        console.log(formatWorkspaceCheckpointRestoreReport(result));
      }
    );

  return checkpoint;
}
