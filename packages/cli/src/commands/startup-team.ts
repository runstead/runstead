import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { collectValues, parsePositiveInteger } from "../startup-command-parsers.js";

export function registerStartupTeamCommand(startup: Command): Command {
  const startupTeam = startup
    .command("team")
    .description("Generate team collaboration and launch review surfaces.");

  startupTeam
    .command("digest")
    .description(
      "Export pending approvals, risk acceptances, reminders, and role views."
    )
    .option("--cwd <path>", "Workspace directory")
    .option("--owner <id>", "Launch decision owner")
    .option("--reviewer <id>", "Launch reviewer")
    .option("--notify <target>", "Notification target", collectValues, [])
    .option("--expiry-window-days <days>", "Reminder window for expiring approvals")
    .option("--actor <id>", "RBAC subject for collaboration digest", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        owner?: string;
        reviewer?: string;
        notify: string[];
        expiryWindowDays?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "generate startup collaboration digest"
        });

        const { generateStartupCollaborationDigest } =
          await import("../startup-collaboration.js");
        const result = await generateStartupCollaborationDigest({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.owner === undefined ? {} : { owner: options.owner }),
          ...(options.reviewer === undefined ? {} : { reviewer: options.reviewer }),
          notify: options.notify,
          ...(options.expiryWindowDays === undefined
            ? {}
            : {
                expiryWindowDays: parsePositiveInteger(
                  options.expiryWindowDays,
                  "--expiry-window-days"
                )
              })
        });

        console.log(`Generated collaboration digest evidence: ${result.evidenceId}`);
        console.log(`Pending approvals: ${result.pendingApprovals.length}`);
        console.log(`Risk acceptances: ${result.riskAcceptances.length}`);
        console.log(`Expiry reminders: ${result.expiryReminders.length}`);
        console.log(`JSON export: ${result.jsonPath}`);
        for (const file of result.files) {
          console.log(`Wrote collaboration digest file: ${file}`);
        }
      }
    );

  return startupTeam;
}
