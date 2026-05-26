import type {
  GenerateStartupCiSummaryResult,
  StartupGitHubCheckRunSummary,
  StartupReleaseGateSummary
} from "./startup-ci-integration.js";
import type { StartupGitHubActionsRemoteStatus } from "./startup-ci-github-actions.js";
import type { StartupGateCheckResult } from "./startup-evidence.js";

export function formatStartupCiSummary(result: GenerateStartupCiSummaryResult): string {
  return [
    "Startup CI integration",
    `Stage: ${result.stage}`,
    `Check: ${result.checkRun.name}`,
    `Conclusion: ${result.checkRun.conclusion}`,
    `Remote GitHub Actions: ${result.remoteActions.status}`,
    ...(result.remoteActions.diagnosis === undefined
      ? []
      : [`Remote CI diagnosis: ${result.remoteActions.diagnosis}`]),
    ...(result.remoteActions.setupAction === undefined
      ? []
      : [`Remote CI setup action: ${result.remoteActions.setupAction}`]),
    `Release gate: ${result.releaseGate.status}`,
    `JSON artifact: ${result.jsonPath}`,
    `PR comment: ${result.markdownPath}`
  ].join("\n");
}

export function startupCheckRunSummary(input: {
  gate: StartupGateCheckResult;
  checkName: string;
}): StartupGitHubCheckRunSummary {
  return {
    name: input.checkName,
    conclusion: input.gate.passed ? "success" : "failure",
    title: input.gate.passed
      ? `${input.gate.stage} gate passed`
      : `${input.gate.stage} gate blocked`,
    summary:
      input.gate.blockers.length === 0
        ? "Runstead found no startup gate blockers."
        : `${input.gate.blockers.length} blocker(s): ${input.gate.blockers.slice(0, 5).join("; ")}`
  };
}

export function formatStartupPrComment(input: {
  gate: StartupGateCheckResult;
  checkRun: StartupGitHubCheckRunSummary;
  remoteActions: StartupGitHubActionsRemoteStatus;
  releaseGate: StartupReleaseGateSummary;
}): string {
  return [
    "## Runstead Startup Gate",
    "",
    `**${input.checkRun.title}**`,
    "",
    `- Check conclusion: \`${input.checkRun.conclusion}\``,
    `- Remote GitHub Actions: \`${formatRemoteActionsStatus(input.remoteActions)}\``,
    `- Release gate: \`${input.releaseGate.status}\``,
    `- Gate event: \`${input.gate.event.eventId}\``,
    "",
    "### Blockers",
    input.gate.blockers.length === 0
      ? "- none"
      : input.gate.blockers.map((blocker) => `- ${blocker}`).join("\n"),
    "",
    "### Warnings",
    input.gate.warnings.length === 0
      ? "- none"
      : input.gate.warnings.map((warning) => `- ${warning}`).join("\n"),
    "",
    "### Remote CI Diagnosis",
    formatRemoteActionsDiagnosis(input.remoteActions),
    "",
    "### Remote Failure Log",
    input.remoteActions.failedJobLogExcerpt === undefined
      ? "- none"
      : [
          `- Job: ${input.remoteActions.failedJobName ?? "unknown"}`,
          ...(input.remoteActions.failedJobLogUrl === undefined
            ? []
            : [`- Log source: ${input.remoteActions.failedJobLogUrl}`]),
          "",
          "```text",
          input.remoteActions.failedJobLogExcerpt,
          "```"
        ].join("\n"),
    "",
    "### Branch Protection",
    input.releaseGate.branchProtectionHint
  ].join("\n");
}

function formatRemoteActionsStatus(status: StartupGitHubActionsRemoteStatus): string {
  return [
    status.status,
    status.repository === undefined ? undefined : `repo=${status.repository}`,
    status.headSha === undefined ? undefined : `head=${status.headSha.slice(0, 12)}`,
    status.workflowRunId === undefined ? undefined : `run=${status.workflowRunId}`,
    status.workflowName === undefined ? undefined : `workflow=${status.workflowName}`,
    status.conclusion === undefined ? undefined : `conclusion=${status.conclusion}`,
    status.failedJobName === undefined
      ? undefined
      : `failed_job=${status.failedJobName}`,
    status.reason === undefined ? undefined : `reason=${status.reason}`,
    status.diagnosis === undefined ? undefined : `diagnosis=${status.diagnosis}`,
    status.setupAction === undefined ? undefined : `setup=${status.setupAction}`
  ]
    .filter((part): part is string => part !== undefined)
    .join("; ");
}

function formatRemoteActionsDiagnosis(
  status: StartupGitHubActionsRemoteStatus
): string {
  if (
    status.reason === undefined &&
    status.diagnosis === undefined &&
    status.setupAction === undefined
  ) {
    return "- none";
  }

  return [
    status.reason === undefined ? undefined : `- Reason: ${status.reason}`,
    status.diagnosis === undefined ? undefined : `- Likely cause: ${status.diagnosis}`,
    status.setupAction === undefined
      ? undefined
      : `- Setup action: ${status.setupAction}`
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}
