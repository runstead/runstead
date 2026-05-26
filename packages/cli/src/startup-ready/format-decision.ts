import type { RuntimeExecutionSemantics } from "@runstead/runtime";

import type { LocalAgentWorkerKind } from "../local-agent.js";
import type { StartupScaffoldProfile } from "../startup-scaffold-profile.js";
import {
  formatStartupReadinessTargetBoundaryLines,
  type StartupReadinessDecision,
  type StartupReadinessTargetBoundary
} from "./decision.js";
import { formatStartupDirtyBreakdown } from "./shared.js";
import type {
  StartupReadinessDirtyBreakdown,
  StartupReadinessDirtyState,
  StartupReadinessEvidenceTier,
  StartupReadinessPhaseStatus,
  StartupReadinessRunStatus,
  StartupReadinessVerdict,
  StartupReadyGuidedStep,
  StartupReadyOperatorCommand,
  StartupReadyPlan,
  StartupReadyStage,
  StartupReadyTarget
} from "./types.js";

export function formatStartupReadinessDecisionMarkdown(input: {
  generatedAt: string;
  run: {
    id: string;
    cwd: string;
    stage: StartupReadyStage;
    target: StartupReadyTarget;
    worker: LocalAgentWorkerKind;
    workerGovernance: string;
    runtimeBackend?: StartupReadyPlan["runtimeBackend"];
    scaffoldProfile?: StartupScaffoldProfile;
    status: StartupReadinessRunStatus;
    verdict: StartupReadinessVerdict;
    verdictBlockers: string[];
    startedAt: string;
    completedAt: string | undefined;
    gitHead: string | undefined;
    dirtyState: StartupReadinessDirtyState;
    dirtyBreakdown?: StartupReadinessDirtyBreakdown;
    codeFingerprint: string | undefined;
  };
  decisions: {
    localDemo: StartupReadinessDecision;
    privateBeta: StartupReadinessDecision;
    publicLaunch: StartupReadinessDecision;
  };
  targetBoundary: StartupReadinessTargetBoundary;
  guidedFlow: StartupReadyGuidedStep[];
  operatorCommands: StartupReadyOperatorCommand[];
  evidence: {
    ids: string[];
    tiers: StartupReadinessEvidenceTier[];
    types: string[];
    phaseEvidence: {
      phase: string;
      status: StartupReadinessPhaseStatus;
      execution?: RuntimeExecutionSemantics;
      evidenceIds: string[];
      artifacts: string[];
      blockers: string[];
      warnings?: string[];
    }[];
  };
  reports: string[];
}): string {
  const decisions = [
    input.decisions.localDemo,
    input.decisions.privateBeta,
    input.decisions.publicLaunch
  ];
  const blockers = decisions.flatMap((decision) =>
    decision.blockers.map((blocker) => `${decision.title}: ${blocker}`)
  );

  return [
    "# Startup Readiness Decision",
    "",
    `Generated: ${input.generatedAt}`,
    `Run: ${input.run.id}`,
    `Workspace: ${input.run.cwd}`,
    `Stage: ${input.run.stage}`,
    `Requested target: ${input.run.target}`,
    `Worker: ${input.run.worker}`,
    input.run.workerGovernance,
    ...(input.run.runtimeBackend === undefined
      ? []
      : [
          `Runtime backend: ${input.run.runtimeBackend.backend} (${input.run.runtimeBackend.storageUri})`
        ]),
    ...(input.run.scaffoldProfile === undefined
      ? []
      : [
          `Scaffold profile: ${input.run.scaffoldProfile.id} (${input.run.scaffoldProfile.title})`
        ]),
    `Status: ${input.run.status}`,
    `Verdict: ${input.run.verdict}`,
    "",
    "## Can this launch?",
    "",
    "| Surface | Answer | Verdict | Next action |",
    "| --- | --- | --- | --- |",
    ...decisions.map(
      (decision) =>
        `| ${decision.title} | ${decision.canLaunch ? "yes" : "no"} | ${decision.verdict} | ${decision.nextAction} |`
    ),
    "",
    "## Target Boundary",
    "",
    ...formatStartupReadinessTargetBoundaryLines(input.targetBoundary),
    "",
    "## Guided Flow",
    "",
    "| Step | Status | Owner | Why | Next action |",
    "| --- | --- | --- | --- | --- |",
    ...input.guidedFlow.map(
      (step) =>
        `| ${step.title} | ${step.status} | ${step.resolution} | ${step.why} | ${step.nextAction} |`
    ),
    "",
    "## Operator Commands",
    "",
    "| Command | When |",
    "| --- | --- |",
    ...input.operatorCommands.map((item) => `| \`${item.command}\` | ${item.when} |`),
    "",
    "## Why not?",
    "",
    blockers.length === 0
      ? "- No blockers for local demo, private beta, or public launch."
      : blockers.map((blocker) => `- ${blocker}`).join("\n"),
    "",
    "## Evidence",
    "",
    `- Git SHA: ${input.run.gitHead ?? "unknown"}`,
    `- Dirty state: ${input.run.dirtyState}`,
    `- Dirty categories: ${formatStartupDirtyBreakdown(input.run.dirtyBreakdown)}`,
    `- Code fingerprint: ${input.run.codeFingerprint ?? "unknown"}`,
    `- Started: ${input.run.startedAt}`,
    `- Completed: ${input.run.completedAt ?? "not completed"}`,
    `- Evidence tiers: ${input.evidence.tiers.length === 0 ? "none" : input.evidence.tiers.join(", ")}`,
    `- Evidence types: ${input.evidence.types.length === 0 ? "none" : input.evidence.types.join(", ")}`,
    `- Evidence ids: ${input.evidence.ids.length === 0 ? "none" : input.evidence.ids.join(", ")}`,
    "",
    "## Phase Evidence",
    "",
    "| Phase | Status | Execution | Evidence | Artifacts | Blockers | Warnings |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...input.evidence.phaseEvidence.map(
      (phase) =>
        `| ${phase.phase} | ${phase.status} | ${formatStartupPhaseExecution(phase.execution)} | ${phase.evidenceIds.length === 0 ? "none" : phase.evidenceIds.join(", ")} | ${phase.artifacts.length === 0 ? "none" : phase.artifacts.join("<br>")} | ${phase.blockers.length === 0 ? "none" : phase.blockers.join("<br>")} | ${phase.warnings === undefined || phase.warnings.length === 0 ? "none" : phase.warnings.join("<br>")} |`
    ),
    "",
    "## Reports",
    "",
    input.reports.length === 0
      ? "- none"
      : input.reports.map((path) => `- ${path}`).join("\n"),
    ""
  ].join("\n");
}

export function formatStartupPhaseExecution(
  execution: RuntimeExecutionSemantics | undefined
): string {
  return execution === undefined
    ? "none"
    : `implementation=${execution.implementation}<br>verification=${execution.verification}<br>agentCompletion=${execution.agentCompletion}`;
}
