import { formatStartupWorkerGovernanceNotice } from "../startup-founder-flow.js";
import type {
  StartupReadinessRun,
  StartupReadyPlan,
  StartupReadyProgressEvent
} from "./types.js";
import {
  formatStartupReadinessTargetBoundaryLines,
  startupReadinessDecisionMatrix,
  startupReadinessTargetBoundary
} from "./decision.js";
import {
  buildStartupReadyGuidedFlow,
  buildStartupReadyOperatorCommands,
  formatStartupReadyGuidedFlowLines,
  formatStartupReadyOperatorCommandLines
} from "./operator-actions.js";
import {
  formatStartupDirtyBreakdown,
  startupReadinessRunGovernanceProfile
} from "./shared.js";

export {
  formatStartupPhaseExecution,
  formatStartupReadinessDecisionMarkdown
} from "./format-decision.js";

export function formatStartupReadyPlan(plan: StartupReadyPlan): string {
  return [
    "Startup readiness plan",
    `Workspace: ${plan.cwd}`,
    `Stage: ${plan.stage}`,
    `Target: ${plan.target}`,
    `Worker: ${plan.worker}`,
    `Governance profile: ${plan.governanceProfile}`,
    formatStartupWorkerGovernanceNotice(plan.worker, plan.governanceProfile),
    ...(plan.scaffoldProfile === undefined
      ? []
      : [
          `Scaffold profile: ${plan.scaffoldProfile.id} (${plan.scaffoldProfile.title})`
        ]),
    `Runstead initialized: ${plan.runsteadInitialized ? "yes" : "no"}`,
    `Runtime backend: ${formatStartupReadyPlanRuntimeBackend(plan)}`,
    `Extensions: ${
      plan.extensions.loaded.length === 0 ? "none" : plan.extensions.loaded.join(", ")
    }`,
    ...(plan.extensions.issues.length === 0
      ? []
      : plan.extensions.issues.map((issue) => `Extension issue: ${issue}`)),
    ...formatStartupReadyPlanSourceConnectors(plan),
    "",
    "Phases:",
    ...plan.phases.flatMap((phase, index) => [
      `${index + 1}. ${phase.title}: ${phase.status}${phase.blockers.length === 0 ? "" : ` (${phase.blockers.join("; ")})`}`,
      ...(phase.nextAction === undefined ? [] : [`   next: ${phase.nextAction}`])
    ])
  ].join("\n");
}

function formatStartupReadyPlanSourceConnectors(plan: StartupReadyPlan): string[] {
  if (plan.sourceConnectors.requirements.length === 0) {
    return ["Source connectors: none"];
  }

  return [
    "Source connectors:",
    ...plan.sourceConnectors.requirements.map((requirement) => {
      const status = requirement.blockers.length === 0 ? "ready" : "blocked";
      const missing =
        requirement.missingTokenEnv.length === 0
          ? ""
          : `; missing ${requirement.missingTokenEnv.join(", ")}`;

      return `- ${requirement.id}: ${status} (${requirement.connectors.join(" or ")}${missing})`;
    })
  ];
}

function formatStartupReadyPlanRuntimeBackend(plan: StartupReadyPlan): string {
  const backend = plan.runtimeBackend;
  const status = backend.setupBlockers.length === 0 ? "ready" : "blocked";
  const team =
    backend.teamReady === undefined
      ? ""
      : `, team=${backend.teamReady ? "ready" : "blocked"}`;
  const live =
    backend.live === undefined
      ? ""
      : `, live=${backend.live.connected ? "connected" : "blocked"} runners=${backend.live.runnerCount} fresh=${backend.live.freshRunnerHeartbeats}`;
  const warnings =
    backend.warnings.length === 0 ? "" : `, warnings=${backend.warnings.length}`;

  return `${backend.backend} ${status} (${backend.storageUri}${team}${live}${warnings})`;
}

function formatStartupReadinessRunRuntimeBackend(run: StartupReadinessRun): string {
  const backend = run.runtimeBackend;

  if (backend === undefined) {
    return "unknown";
  }

  const status = backend.setupBlockers.length === 0 ? "ready" : "blocked";
  const live =
    backend.live === undefined
      ? ""
      : `, live=${backend.live.connected ? "connected" : "blocked"} runners=${backend.live.runnerCount} fresh=${backend.live.freshRunnerHeartbeats}`;

  return `${backend.backend} ${status} (${backend.storageUri}${live})`;
}

export function formatStartupReadinessRun(run: StartupReadinessRun): string {
  const decisions = startupReadinessDecisionMatrix(run);
  const orderedDecisions = [
    decisions.localDemo,
    decisions.privateBeta,
    decisions.publicLaunch
  ];
  const requestedDecision = orderedDecisions.find(
    (decision) => decision.target === run.target
  );
  const guidedFlow =
    run.guidedFlow.length === 0 ? buildStartupReadyGuidedFlow(run) : run.guidedFlow;
  const operatorCommands =
    run.operatorCommands.length === 0
      ? buildStartupReadyOperatorCommands(run)
      : run.operatorCommands;

  return [
    `Runstead startup readiness run: ${run.id}`,
    `Worker: ${run.worker}`,
    `Governance profile: ${startupReadinessRunGovernanceProfile(run)}`,
    formatStartupWorkerGovernanceNotice(
      run.worker,
      startupReadinessRunGovernanceProfile(run)
    ),
    `Runtime backend: ${formatStartupReadinessRunRuntimeBackend(run)}`,
    ...(run.scaffoldProfile === undefined
      ? []
      : [`Scaffold profile: ${run.scaffoldProfile.id} (${run.scaffoldProfile.title})`]),
    "",
    ...run.phases.map(
      (phase, index) => `${index + 1}. ${phase.title.padEnd(28)} ${phase.status}`
    ),
    "",
    `Status: ${run.status}`,
    `Target: ${run.target}`,
    `Verdict: ${run.verdict}`,
    `Evidence tiers: ${run.evidenceTiers.length === 0 ? "none" : run.evidenceTiers.join(", ")}`,
    `Evidence types: ${run.evidenceTypes.length === 0 ? "none" : run.evidenceTypes.join(", ")}`,
    `Verdict blockers: ${run.verdictBlockers.length === 0 ? "none" : run.verdictBlockers.join("; ")}`,
    `Git head: ${run.gitHead ?? "unknown"}`,
    `Dirty state: ${run.dirtyState}`,
    `Dirty categories: ${formatStartupDirtyBreakdown(run.dirtyBreakdown)}`,
    `Code fingerprint: ${run.codeFingerprint ?? "unknown"}`,
    "",
    "Launch decision:",
    `- Requested target: ${run.target} ${requestedDecision?.canLaunch === true ? "ready" : "blocked"} (${run.verdict})`,
    ...orderedDecisions.map(
      (decision) =>
        `- ${decision.title}: ${decision.canLaunch ? "yes" : "no"} (${decision.nextAction})`
    ),
    "",
    "Target boundary:",
    ...formatStartupReadinessTargetBoundaryLines(
      startupReadinessTargetBoundary(run.target)
    ),
    "",
    "Guided readiness flow:",
    ...formatStartupReadyGuidedFlowLines(guidedFlow),
    "",
    "Operator commands:",
    ...formatStartupReadyOperatorCommandLines(operatorCommands),
    "",
    "Evidence summary:",
    `- Phase evidence refs: ${run.evidenceIds.length}`,
    `- Evidence tiers: ${run.evidenceTiers.length === 0 ? "none" : run.evidenceTiers.join(", ")}`,
    `- Evidence types: ${run.evidenceTypes.length === 0 ? "none" : run.evidenceTypes.join(", ")}`,
    "",
    "Reports:",
    run.reportPaths.length === 0
      ? "- none"
      : run.reportPaths.map((path) => `- ${path}`).join("\n")
  ].join("\n");
}

export function formatStartupReadyProgress(event: StartupReadyProgressEvent): string {
  const scope =
    event.phaseTitle === undefined
      ? "run"
      : `${event.phaseTitle} (${event.phaseId ?? "phase"})`;
  const details = [
    `[startup ready] ${scope}: ${event.status}`,
    event.message,
    ...(event.blockers === undefined || event.blockers.length === 0
      ? []
      : [`blockers=${event.blockers.length}`]),
    ...(event.evidenceIds === undefined || event.evidenceIds.length === 0
      ? []
      : [`evidence=${event.evidenceIds.length}`]),
    ...(event.artifacts === undefined || event.artifacts.length === 0
      ? []
      : [`artifacts=${event.artifacts.length}`])
  ];

  return details.join(" | ");
}
