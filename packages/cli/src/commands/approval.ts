import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { approvalGrantReuseSummary } from "./approval-format.js";
import { registerApprovalReadCommands } from "./approval-read.js";

export function registerApprovalCommand(program: Command): Command {
  const approval = program.command("approval").description("Manage approvals.");

  registerApprovalReadCommands(approval);

  approval
    .command("approve")
    .description("Approve a pending approval request.")
    .argument("<id>", "Approval id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for approval decisions", "local-admin")
    .option("--decided-by <id>", "Approver id")
    .action(
      async (
        id: string,
        options: { cwd?: string; actor: string; decidedBy?: string }
      ) => {
        const actor = options.decidedBy ?? options.actor;
        const { approvalActionMetadata, decideApproval, showApproval } =
          await import("../approvals.js");
        const shown = showApproval({ ...options, id });
        const metadata = approvalActionMetadata(shown.policyDecision);
        const result = await decideApproval({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          id,
          decision: "approved",
          decidedBy: actor
        });

        console.log(`Approved: ${result.approval.id}`);
        console.log(`Task: ${shown.task?.id ?? "none"}`);
        console.log(`Grant reuse: ${approvalGrantReuseSummary(metadata)}`);
        if (shown.task !== undefined) {
          console.log(`Resume: runstead agent resume ${shown.task.id}`);
          console.log(
            `Resume by approval: runstead agent resume ${result.approval.id}`
          );
        }
      }
    );

  approval
    .command("approve-and-resume")
    .description("Approve a pending approval request and resume its local agent task.")
    .argument("<id>", "Approval id")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--actor <id>",
      "RBAC subject for approval and task execution",
      "local-admin"
    )
    .option("--decided-by <id>", "Approver id")
    .action(
      async (
        id: string,
        options: { cwd?: string; actor: string; decidedBy?: string }
      ) => {
        const actor = options.decidedBy ?? options.actor;
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor,
          permission: "task.run",
          action: "resume local agent tasks"
        });

        const { approvalActionMetadata, decideApproval, showApproval } =
          await import("../approvals.js");
        const { formatLocalAgentRunReport, localAgentRunExitCode, runLocalAgentTask } =
          await import("../local-agent.js");
        const shown = showApproval({ ...options, id });
        const metadata = approvalActionMetadata(shown.policyDecision);
        const result = await decideApproval({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          id,
          decision: "approved",
          decidedBy: actor
        });

        console.log(`Approved: ${result.approval.id}`);
        console.log(`Grant reuse: ${approvalGrantReuseSummary(metadata)}`);

        if (shown.task === undefined) {
          console.log(
            "Resume: skipped; no local agent task is associated with this approval."
          );
          return;
        }

        const resumed = await runLocalAgentTask({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          taskId: shown.task.id
        });
        const exitCode = localAgentRunExitCode(resumed);

        console.log(formatLocalAgentRunReport(resumed));
        if (exitCode !== 0) {
          process.exitCode = exitCode;
        }
      }
    );

  approval
    .command("deny")
    .description("Deny a pending approval request.")
    .argument("<id>", "Approval id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for approval decisions", "local-admin")
    .option("--decided-by <id>", "Approver id")
    .action(
      async (
        id: string,
        options: { cwd?: string; actor: string; decidedBy?: string }
      ) => {
        const actor = options.decidedBy ?? options.actor;
        const { decideApproval } = await import("../approvals.js");
        const result = await decideApproval({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          id,
          decision: "denied",
          decidedBy: actor
        });

        console.log(`Denied: ${result.approval.id}`);
      }
    );

  return approval;
}
