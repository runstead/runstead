import { requireRbacPermission } from "../cli-rbac.js";

import {
  agentReportOutputFormat,
  formatAgentReportOutput
} from "./agent-report-output.js";

export interface AgentReportCliOptions {
  cwd?: string;
  actor: string;
  json?: boolean;
  markdown?: boolean;
}

export interface AgentUndoCliOptions {
  cwd?: string;
  actor: string;
  allowHeadMismatch?: boolean;
}

export async function runAgentReportCommand(
  taskId: string,
  options: AgentReportCliOptions
): Promise<void> {
  const outputFormat = agentReportOutputFormat(options);

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
    formatAgentReportOutput(outputFormat, {
      text: () => formatLocalAgentTaskReport(report),
      json: () => formatLocalAgentTaskReportJson(report),
      markdown: () => formatLocalAgentTaskReportMarkdown(report)
    })
  );
}

export async function runAgentUndoCommand(
  taskId: string,
  options: AgentUndoCliOptions
): Promise<void> {
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
}
