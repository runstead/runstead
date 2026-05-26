import { formatStartupDependencyApprovalBoundary } from "./startup-dependency-approval.js";
import { formatStartupRepoOnboarding } from "./startup-repo-onboarding.js";
import type {
  StartupBuildMvpResult,
  StartupGeneratedStep,
  StartupLaunchCheckResult,
  StartupMvpVerifierRun,
  StartupOnboardResult,
  StartupScaleCheckResult
} from "./startup-founder-flow.js";

export function formatStartupOnboard(result: StartupOnboardResult): string {
  return [
    "Startup onboard",
    `Root: ${result.root}`,
    `Goal: ${result.init.goal.id} ${result.init.goal.title}`,
    "",
    formatStartupRepoOnboarding(result.repo),
    "",
    `Context: ${formatGeneratedStep(result.context)}`,
    `Measurement: ${formatGeneratedStep(result.measurement)}`,
    "",
    "Onboarding files:",
    listItems(result.onboardingFiles),
    "",
    "Next commands:",
    listItems(result.nextCommands)
  ].join("\n");
}

export function formatStartupBuildMvp(result: StartupBuildMvpResult): string {
  return [
    "Startup build MVP",
    `Worker: ${result.worker}`,
    `Task: ${result.localAgentTaskId}`,
    `Status: ${result.status}`,
    `Execution: implementation=${result.execution.implementation} verification=${result.execution.verification} agentCompletion=${result.execution.agentCompletion}`,
    `Summary: ${result.summary}`,
    `Max turns: ${result.maxTurns}`,
    `Dependency policy: ${formatStartupDependencyApprovalBoundary(result.dependencyApproval)}`,
    `Attempts: ${result.attempts.length}`,
    `Verifier run: ${formatStartupMvpVerifierRun(result.verifierRun)}`,
    `MVP gate: ${result.gate.passed ? "passed" : "blocked"}`,
    "",
    "Next commands:",
    listItems(result.nextCommands)
  ].join("\n");
}

export function formatStartupLaunchCheck(result: StartupLaunchCheckResult): string {
  return [
    "Startup launch check",
    `Status: ${result.status}`,
    `Report: ${result.reportPath}`,
    `Gate: ${result.gate.passed ? "passed" : "blocked"}`,
    `Blockers: ${result.blockers.length}`,
    "",
    "Next commands:",
    listItems(result.nextCommands)
  ].join("\n");
}

export function formatStartupScaleCheck(result: StartupScaleCheckResult): string {
  return [
    "Startup scale check",
    `Ops report: ${result.opsReport.files[0] ?? "none"}`,
    `Gate: ${result.gate.passed ? "passed" : "blocked"}`,
    `Blockers: ${result.gate.blockers.length}`,
    "",
    "Next commands:",
    listItems(result.nextCommands)
  ].join("\n");
}

export function listItems(items: string[]): string {
  return items.length === 0 ? "- none" : items.map((item) => `- ${item}`).join("\n");
}

function formatStartupMvpVerifierRun(run: StartupMvpVerifierRun): string {
  if (run.status === "skipped") {
    return `skipped (${run.reason})`;
  }

  const passed = run.commandResults.filter(
    (result) => result.exitCode === 0 && result.timedOut === false
  ).length;

  return `${run.status} (${passed}/${run.commandResults.length} commands passed, task=${run.taskId})`;
}

function formatGeneratedStep<T>(step: StartupGeneratedStep<T>): string {
  return step.status === "generated" ? "generated" : `skipped (${step.reason})`;
}
