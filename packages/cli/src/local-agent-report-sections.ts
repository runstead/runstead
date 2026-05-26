import type { JsonObject } from "@runstead/core";

import type {
  LocalAgentReportToolCall,
  LocalAgentTaskReport
} from "./local-agent-report.js";
import { localAgentTaskMode, localAgentTaskWorker } from "./local-agent-task-input.js";

const LOCAL_AGENT_FILE_ACTIVITY_ACTION_TYPES = new Set([
  "worker.native.start",
  "worker.external.start",
  "filesystem.read",
  "filesystem.write",
  "filesystem.patch",
  "git.status",
  "git.diff",
  "git.log",
  "git.show",
  "git.diff.summary",
  "shell.exec",
  "verifier.run",
  "evidence.read",
  "workspace.facts.read"
]);

export interface LocalAgentVerifierReportRow {
  verifier: string;
  exitCode?: number | string | null;
  timedOut?: boolean;
  evidenceId?: string;
}

export interface LocalAgentReportSections {
  task: {
    id: string;
    status: string;
    goalId: string;
    worker: string;
    mode: string;
  };
  model: {
    provider: string | undefined;
    model: string | undefined;
    modelSource: string | undefined;
    status: string | undefined;
    summary: string | undefined;
    toolCalls: number | undefined;
    failedToolCalls: number | undefined;
  };
  workerRuntime: {
    command: string | undefined;
    governance: JsonObject | undefined;
    outputValidation: JsonObject | undefined;
    stdoutBytes: number | undefined;
    stderrBytes: number | undefined;
  };
  fileActivity: LocalAgentReportToolCall[];
  verifiers: LocalAgentVerifierReportRow[];
  failedToolCalls: LocalAgentReportToolCall[];
  policy: LocalAgentTaskReport["audit"]["policyDecisions"];
  approvals: LocalAgentTaskReport["audit"]["approvals"];
  checkpoint: string | undefined;
  audit: LocalAgentTaskReport["audit"];
}

export function localAgentReportSections(
  report: LocalAgentTaskReport
): LocalAgentReportSections {
  return {
    task: {
      id: report.task.id,
      status: report.task.status,
      goalId: report.goal.id,
      worker: localAgentTaskWorker(report.task),
      mode: localAgentTaskMode(report.task)
    },
    model: {
      provider: stringOutput(report.task.output ?? {}, "modelProvider") || undefined,
      model: stringOutput(report.task.output ?? {}, "model") || undefined,
      modelSource: stringOutput(report.task.output ?? {}, "modelSource") || undefined,
      status: stringOutput(report.task.output ?? {}, "status") || undefined,
      summary: stringOutput(report.task.output ?? {}, "summary") || undefined,
      toolCalls: numberOutput(report.task.output ?? {}, "toolCalls"),
      failedToolCalls: numberOutput(report.task.output ?? {}, "failedToolCalls")
    },
    workerRuntime: {
      command: stringOutput(report.task.output ?? {}, "command") || undefined,
      governance: recordOutput(report.task.output ?? {}, "governance"),
      outputValidation: recordOutput(report.task.output ?? {}, "outputValidation"),
      stdoutBytes: numberOutput(report.task.output ?? {}, "stdoutBytes"),
      stderrBytes: numberOutput(report.task.output ?? {}, "stderrBytes")
    },
    fileActivity: report.toolCalls.filter((call) =>
      LOCAL_AGENT_FILE_ACTIVITY_ACTION_TYPES.has(call.actionType)
    ),
    verifiers: verifierReportRows(report.task.output ?? {}),
    failedToolCalls: report.toolCalls.filter((call) => call.status !== "completed"),
    policy: report.audit.policyDecisions,
    approvals: report.audit.approvals,
    checkpoint: stringOutput(report.task.output ?? {}, "checkpointId") || undefined,
    audit: report.audit
  };
}

function verifierReportRows(output: JsonObject): LocalAgentVerifierReportRow[] {
  const verifiers = output.verifiers;

  return Array.isArray(verifiers)
    ? verifiers.filter(isVerifierReportRow).map((row) => ({
        verifier: row.verifier,
        ...(row.exitCode === undefined ? {} : { exitCode: row.exitCode }),
        ...(row.timedOut === undefined ? {} : { timedOut: row.timedOut }),
        ...(row.evidenceId === undefined ? {} : { evidenceId: row.evidenceId })
      }))
    : [];
}

function stringOutput(output: JsonObject, key: string): string {
  const value = output[key];

  return typeof value === "string" ? value : "";
}

function numberOutput(output: JsonObject, key: string): number | undefined {
  const value = output[key];

  return typeof value === "number" ? value : undefined;
}

function recordOutput(output: JsonObject, key: string): JsonObject | undefined {
  const value = output[key];

  return isRecord(value) ? value : undefined;
}

function isVerifierReportRow(value: unknown): value is LocalAgentVerifierReportRow {
  return isRecord(value) && typeof value.verifier === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
