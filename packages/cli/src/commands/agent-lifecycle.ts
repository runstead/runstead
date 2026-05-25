import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";

interface AgentReportCliOptions {
  cwd?: string;
  actor: string;
  json?: boolean;
  markdown?: boolean;
}

interface AgentResumeCliOptions {
  cwd?: string;
  actor: string;
}

interface AgentUndoCliOptions {
  cwd?: string;
  actor: string;
  allowHeadMismatch?: boolean;
}

export function registerAgentLifecycleCommands(command: Command): void {
  command
    .command("report")
    .description("Summarize a local agent task and its audit trail.")
    .argument("<task-id>", "Local agent task id")
    .option("--cwd <path>", "Workspace directory")
    .option("--json", "Print the report as JSON")
    .option("--markdown", "Print the report as Markdown")
    .option("--actor <id>", "RBAC subject for local agent reporting", "local-admin")
    .action(async (taskId: string, options: AgentReportCliOptions) => {
      if (options.json === true && options.markdown === true) {
        throw new Error("agent report accepts only one of --json or --markdown");
      }

      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "audit.read",
        action: "read local agent reports"
      });

      const {
        formatLocalAgentTaskReport,
        formatLocalAgentTaskReportJson,
        formatLocalAgentTaskReportMarkdown,
        loadLocalAgentTaskReport
      } = await import("../local-agent.js");
      const report = await loadLocalAgentTaskReport({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        taskId
      });

      console.log(
        options.json === true
          ? formatLocalAgentTaskReportJson(report).trimEnd()
          : options.markdown === true
            ? formatLocalAgentTaskReportMarkdown(report)
            : formatLocalAgentTaskReport(report)
      );
    });

  command
    .command("resume")
    .description("Resume a queued local agent task after an approval decision.")
    .argument("<task-or-approval-id>", "Local agent task id or approval id")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for local agent execution", "local-admin")
    .action(async (targetId: string, options: AgentResumeCliOptions) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "task.run",
        action: "resume local agent tasks"
      });

      const {
        formatLocalAgentRunReport,
        localAgentRunExitCode,
        resolveLocalAgentResumeTarget,
        runLocalAgentTask
      } = await import("../local-agent.js");
      const resumeTarget = resolveLocalAgentResumeTarget({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        targetId
      });
      const result = await runLocalAgentTask({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        taskId: resumeTarget.taskId
      });
      const exitCode = localAgentRunExitCode(result);

      if (resumeTarget.note !== undefined) {
        console.log(resumeTarget.note);
      }
      console.log(formatLocalAgentRunReport(result));
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });

  command
    .command("undo")
    .description("Restore the checkpoint created before a local agent edit or repair.")
    .argument("<task-id>", "Local agent task id")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--allow-head-mismatch",
      "Restore even when the current HEAD differs from the checkpoint HEAD"
    )
    .option("--actor <id>", "RBAC subject for local agent undo", "local-admin")
    .action(async (taskId: string, options: AgentUndoCliOptions) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "repo.manage",
        action: "undo local agent tasks"
      });

      const { formatLocalAgentUndoReport, undoLocalAgentTask } =
        await import("../local-agent.js");
      const result = await undoLocalAgentTask({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        taskId,
        actor: options.actor,
        allowHeadMismatch: options.allowHeadMismatch === true
      });

      console.log(formatLocalAgentUndoReport(result));
    });
}
