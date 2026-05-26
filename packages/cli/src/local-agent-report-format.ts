import type { JsonObject, Task } from "@runstead/core";

import {
  diagnoseLocalAgentTask,
  formatLocalAgentDiagnostics
} from "./local-agent-diagnostics.js";
import {
  localAgentReportSections,
  type LocalAgentReportSections,
  type LocalAgentVerifierReportRow
} from "./local-agent-report-sections.js";
import type {
  LocalAgentAuditCount,
  LocalAgentAuditSummary,
  LocalAgentPolicyDecisionCount,
  LocalAgentReportToolCall,
  LocalAgentTaskReport
} from "./local-agent-report.js";
import { localAgentTaskMode, localAgentTaskWorker } from "./local-agent-task-input.js";

export function formatLocalAgentTaskReport(report: LocalAgentTaskReport): string {
  const sections = localAgentReportSections(report);

  return [
    "Runstead agent report",
    `Task: ${report.task.id}`,
    `Goal: ${report.goal.id} ${report.goal.title}`,
    `Status: ${report.task.status}`,
    `Worker: ${localAgentTaskWorker(report.task)}`,
    `Mode: ${localAgentTaskMode(report.task)}`,
    ...(sections.model.provider === undefined
      ? []
      : [`Provider: ${sections.model.provider}`]),
    ...(sections.model.model === undefined ? [] : [`Model: ${sections.model.model}`]),
    ...(sections.model.modelSource === undefined
      ? []
      : [`Model source: ${sections.model.modelSource}`]),
    ...formatWrappedWorkerTaskReportLines(sections),
    ...(sections.checkpoint === undefined
      ? []
      : [`Checkpoint: ${sections.checkpoint}`]),
    ...formatOutputWarnings(report.task),
    ...formatLocalAgentDiagnostics(diagnoseLocalAgentTask(report.task)),
    ...(sections.model.summary === undefined
      ? []
      : ["Model summary:", `  ${sections.model.summary}`]),
    "File/tool activity:",
    ...formatReportToolCalls(sections.fileActivity),
    "Verifier evidence:",
    ...formatReportVerifiers(sections.verifiers),
    "Failed tool calls:",
    ...formatReportToolCalls(sections.failedToolCalls),
    ...formatLocalAgentAuditSummary(report.audit)
  ].join("\n");
}

export function formatLocalAgentTaskReportJson(report: LocalAgentTaskReport): string {
  return `${JSON.stringify(localAgentReportSections(report), null, 2)}\n`;
}

export function formatLocalAgentTaskReportMarkdown(
  report: LocalAgentTaskReport
): string {
  const sections = localAgentReportSections(report);

  return [
    `# Runstead agent report: ${report.task.id}`,
    "",
    `- Status: ${report.task.status}`,
    `- Goal: ${report.goal.id} ${report.goal.title}`,
    `- Worker: ${localAgentTaskWorker(report.task)}`,
    `- Mode: ${localAgentTaskMode(report.task)}`,
    ...(sections.model.provider === undefined
      ? []
      : [`- Provider: ${sections.model.provider}`]),
    ...(sections.model.model === undefined ? [] : [`- Model: ${sections.model.model}`]),
    ...(sections.model.modelSource === undefined
      ? []
      : [`- Model source: ${sections.model.modelSource}`]),
    ...formatWrappedWorkerTaskReportLines(sections).map((line) => `- ${line}`),
    ...(sections.checkpoint === undefined
      ? []
      : [`- Checkpoint: ${sections.checkpoint}`]),
    "",
    "## Model Summary",
    "",
    sections.model.summary ?? "None recorded.",
    "",
    "## File And Tool Activity",
    "",
    ...markdownToolCalls(sections.fileActivity),
    "",
    "## Verifier Evidence",
    "",
    ...markdownVerifiers(sections.verifiers),
    "",
    "## Failed Tool Calls",
    "",
    ...markdownToolCalls(sections.failedToolCalls),
    "",
    "## Policy And Approval",
    "",
    ...formatLocalAgentAuditSummary(report.audit).map((line) => `- ${line.trim()}`)
  ].join("\n");
}

export function formatLocalAgentAuditSummary(audit: LocalAgentAuditSummary): string[] {
  return [
    "Audit:",
    ...formatAuditCountGroup("  worker_runs", audit.workerRuns),
    ...formatAuditCountGroup("  tool_calls", audit.toolCalls),
    ...formatPolicyDecisionCounts(audit.policyDecisions),
    ...formatAuditCountGroup("  approvals", audit.approvals)
  ];
}

export function formatLocalAgentWarnings(warnings: string[] | undefined): string[] {
  return warnings === undefined || warnings.length === 0
    ? []
    : ["Warnings:", ...warnings.map((warning) => `  ${warning}`)];
}

function formatReportToolCalls(calls: LocalAgentReportToolCall[]): string[] {
  return calls.length === 0
    ? ["  none"]
    : calls.map(
        (call) =>
          `  ${call.actionType} ${call.status}${call.resource === undefined ? "" : ` ${call.resource}`}${formatToolCallInlineSummary(call)}`
      );
}

function formatToolCallInlineSummary(call: LocalAgentReportToolCall): string {
  const summary = call.summary === undefined ? "" : ` summary=${call.summary}`;
  const failure =
    call.failureKind === undefined
      ? ""
      : ` failure=${call.failureKind} recoverable=${call.recoverable === true ? "yes" : "no"} explanation=${call.failureExplanation ?? "none"}`;

  return `${summary}${failure}`;
}

function formatReportVerifiers(verifiers: LocalAgentVerifierReportRow[]): string[] {
  return verifiers.length === 0
    ? ["  none"]
    : verifiers.map(
        (verifier) =>
          `  ${verifier.verifier}: exit=${verifier.exitCode ?? "unknown"} evidence=${verifier.evidenceId ?? "none"}`
      );
}

function formatWrappedWorkerTaskReportLines(
  sections: LocalAgentReportSections
): string[] {
  const governance = sections.workerRuntime.governance;

  if (sections.workerRuntime.command === undefined && governance === undefined) {
    return [];
  }

  const outputValidation = sections.workerRuntime.outputValidation;
  const outputValid =
    outputValidation === undefined
      ? "unknown"
      : outputValidation.valid === true
        ? "yes"
        : "no";
  const hardProxy =
    governance === undefined
      ? "unknown"
      : governance.hardProxyToolCalls === true
        ? "yes"
        : "no";

  return [
    "Worker runtime:",
    ...(sections.workerRuntime.command === undefined
      ? []
      : [`  command: ${sections.workerRuntime.command}`]),
    `  boundary: ${stringRecordValue(governance, "boundary") ?? "unknown"}`,
    `  governance level: ${stringRecordValue(governance, "level") ?? "unknown"}`,
    `  hard-proxied tool calls: ${hardProxy}`,
    ...(sections.workerRuntime.outputValidation === undefined
      ? []
      : [`  output valid: ${outputValid}`]),
    ...(sections.workerRuntime.stdoutBytes === undefined
      ? []
      : [`  stdout bytes: ${sections.workerRuntime.stdoutBytes}`]),
    ...(sections.workerRuntime.stderrBytes === undefined
      ? []
      : [`  stderr bytes: ${sections.workerRuntime.stderrBytes}`])
  ];
}

function markdownToolCalls(calls: LocalAgentReportToolCall[]): string[] {
  return calls.length === 0
    ? ["None recorded."]
    : calls.map(
        (call) =>
          `- ${call.actionType} ${call.status}${call.resource === undefined ? "" : ` (${call.resource})`}${formatToolCallInlineSummary(call)}`
      );
}

function markdownVerifiers(verifiers: LocalAgentVerifierReportRow[]): string[] {
  return verifiers.length === 0
    ? ["None recorded."]
    : verifiers.map(
        (verifier) =>
          `- ${verifier.verifier}: exit=${verifier.exitCode ?? "unknown"}, evidence=${verifier.evidenceId ?? "none"}`
      );
}

function formatAuditCountGroup(label: string, rows: LocalAgentAuditCount[]): string[] {
  return rows.length === 0
    ? [`${label}: none`]
    : rows.map((row) => `${label}: ${row.name} ${row.status} x${row.count}`);
}

function formatPolicyDecisionCounts(rows: LocalAgentPolicyDecisionCount[]): string[] {
  return rows.length === 0
    ? ["  policy_decisions: none"]
    : rows.map(
        (row) => `  policy_decisions: ${row.decision} ${row.risk} x${row.count}`
      );
}

function formatOutputWarnings(task: Task): string[] {
  const warnings = task.output?.warnings;

  return Array.isArray(warnings)
    ? formatLocalAgentWarnings(
        warnings.filter((warning): warning is string => typeof warning === "string")
      )
    : [];
}

function stringRecordValue(
  record: JsonObject | undefined,
  key: string
): string | undefined {
  const value = record?.[key];

  return typeof value === "string" ? value : undefined;
}
