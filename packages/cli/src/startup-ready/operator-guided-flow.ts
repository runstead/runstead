import type {
  StartupReadyGuidedResolution,
  StartupReadyGuidedStep,
  StartupReadinessRun,
  StartupReadinessRunPhase
} from "./types.js";
import {
  nextStartupReadinessAction,
  startupReadinessDecision,
  startupReadinessTargetBoundary
} from "./decision.js";
import {
  startupReadySourceConnectorBlocker,
  startupReadySourcePlanCommand
} from "./source-guidance.js";
import { startupReadyShellArg } from "./shared.js";

export function buildStartupReadyGuidedFlow(
  run: StartupReadinessRun
): StartupReadyGuidedStep[] {
  const blockedPhases = run.phases.filter(
    (phase) => phase.status === "blocked" || phase.status === "failed"
  );
  const phaseSteps = blockedPhases.map((phase, index) =>
    startupReadyGuidedStepForPhase(run, phase, index)
  );

  if (phaseSteps.length > 0) {
    return phaseSteps;
  }

  const requestedDecision = startupReadinessDecision({
    surface:
      run.target === "local"
        ? "local_demo"
        : run.target === "staging"
          ? "private_beta"
          : "public_launch",
    title:
      run.target === "local"
        ? "Local demo"
        : run.target === "staging"
          ? "Private beta / staging"
          : "Public launch",
    target: run.target,
    run
  });

  if (requestedDecision.blockers.length > 0) {
    return requestedDecision.blockers.map((blocker, index) =>
      startupReadyGuidedStepForBlocker({
        id: `target_${index + 1}`,
        title: `Target evidence: ${run.target}`,
        blocker,
        fallbackNextAction: requestedDecision.nextAction,
        run
      })
    );
  }

  const boundary = startupReadinessTargetBoundary(run.target);

  return [
    {
      id: "next_target",
      title: `Next target after ${run.target}`,
      status: "next",
      resolution: "manual",
      why: boundary.boundary,
      nextAction: boundary.requiredNextEvidence.join("; "),
      blockers: []
    }
  ];
}

export function startupReadyGuidedStepForPhase(
  run: StartupReadinessRun,
  phase: StartupReadinessRunPhase,
  index: number
): StartupReadyGuidedStep {
  const blocker =
    phase.blockers.find(startupReadySourceConnectorBlocker) ??
    phase.blockers[0] ??
    `${phase.title} has not completed successfully`;

  return startupReadyGuidedStepForBlocker({
    id: `${phase.id}_${index + 1}`,
    title: phase.title,
    blocker,
    fallbackNextAction: phase.nextAction ?? nextStartupReadinessAction([blocker]),
    run,
    blockers: phase.blockers.length === 0 ? [blocker] : phase.blockers
  });
}

export function startupReadyGuidedStepForBlocker(input: {
  id: string;
  title: string;
  blocker: string;
  fallbackNextAction: string;
  run: StartupReadinessRun;
  blockers?: string[];
}): StartupReadyGuidedStep {
  const resolution = startupReadyGuidedResolution(input.blocker);
  const command = startupReadyGuidedCommand({
    blocker: input.blocker,
    resolution,
    run: input.run
  });

  return {
    id: input.id,
    title: input.title,
    status: "blocked",
    resolution,
    why: startupReadyGuidedWhy(input.blocker),
    nextAction: startupReadyGuidedNextAction({
      blocker: input.blocker,
      fallbackNextAction: input.fallbackNextAction,
      resolution,
      run: input.run
    }),
    ...(command === undefined ? {} : { command }),
    blockers: input.blockers ?? [input.blocker]
  };
}

export function startupReadyGuidedResolution(
  blocker: string
): StartupReadyGuidedResolution {
  const lower = blocker.toLowerCase();

  if (startupReadySourceConnectorBlocker(blocker)) {
    return "runstead";
  }

  if (
    lower.includes("deployment") ||
    lower.includes("analytics") ||
    lower.includes("support") ||
    lower.includes("feedback") ||
    lower.includes("rollback") ||
    lower.includes("observability") ||
    lower.includes("migration") ||
    lower.includes("release-plan")
  ) {
    return "manual";
  }

  if (
    lower.includes("ui smoke") ||
    lower.includes("verifier") ||
    lower.includes("repo readiness") ||
    lower.includes("security baseline") ||
    lower.includes("ci provider") ||
    lower.includes("ci-verified")
  ) {
    return "agent";
  }

  return "runstead";
}

export function startupReadyGuidedWhy(blocker: string): string {
  const lower = blocker.toLowerCase();

  if (startupReadySourceConnectorBlocker(blocker)) {
    return "Runstead needs external source connector evidence or credentials before it can trust this target.";
  }

  if (lower.includes("ui smoke")) {
    return "Runstead cannot prove the primary product flow works in a browser.";
  }

  if (lower.includes("verifier") || lower.includes("local command")) {
    return "The launch gate needs current command evidence from tests, lint, typecheck, or build.";
  }

  if (lower.includes("ci")) {
    return "The requested target needs remote regression evidence, not only local execution.";
  }

  if (lower.includes("deployment")) {
    return "The requested target needs evidence from the actual deployment surface.";
  }

  if (lower.includes("rollback")) {
    return "Launch readiness needs proof that the release can be reversed safely.";
  }

  if (lower.includes("observability")) {
    return "Launch readiness needs a monitoring and alerting baseline for the release target.";
  }

  if (lower.includes("analytics")) {
    return "Production readiness needs measured real-user behavior, not synthetic smoke alone.";
  }

  if (lower.includes("support") || lower.includes("feedback")) {
    return "Production readiness needs a triage path for user feedback or incidents.";
  }

  return `Runstead is missing evidence for: ${blocker}.`;
}

export function startupReadyGuidedNextAction(input: {
  blocker: string;
  fallbackNextAction: string;
  resolution: StartupReadyGuidedResolution;
  run: StartupReadinessRun;
}): string {
  if (startupReadySourceConnectorBlocker(input.blocker)) {
    return `inspect required ${input.run.target} source connector refresh commands and credential blockers`;
  }

  if (input.resolution === "agent") {
    return `let ${input.run.worker} repair the repo, then resume this readiness run`;
  }

  if (input.resolution === "manual") {
    return input.fallbackNextAction;
  }

  return input.fallbackNextAction;
}

export function startupReadyGuidedCommand(input: {
  blocker: string;
  resolution: StartupReadyGuidedResolution;
  run: StartupReadinessRun;
}): string | undefined {
  const lower = input.blocker.toLowerCase();

  if (startupReadySourceConnectorBlocker(input.blocker)) {
    return startupReadySourcePlanCommand(input.run);
  }

  if (input.resolution === "agent") {
    const cwd = startupReadyShellArg(input.run.cwd);

    return `runstead startup ready --cwd ${cwd} --resume ${input.run.id}`;
  }

  if (lower.includes("ci")) {
    const cwd = startupReadyShellArg(input.run.cwd);

    return `runstead startup ready --cwd ${cwd} --stage ${input.run.stage} --target ${input.run.target} --ci`;
  }

  return undefined;
}

export function formatStartupReadyGuidedFlowLines(
  steps: StartupReadyGuidedStep[]
): string[] {
  return steps.map((step) => {
    const command = step.command === undefined ? "" : ` command: ${step.command};`;

    return `- [${step.status}] ${step.title}: ${step.resolution};${command} why: ${step.why}; next: ${step.nextAction}`;
  });
}
