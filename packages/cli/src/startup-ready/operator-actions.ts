import type {
  StartupReadyGuidedResolution,
  StartupReadyGuidedStep,
  StartupReadyOperatorCommand,
  StartupReadinessRun,
  StartupReadinessRunPhase
} from "./types.js";
import {
  nextStartupReadinessAction,
  startupReadinessDecision,
  startupReadinessTargetBoundary
} from "./decision.js";
import {
  startupReadinessRunGovernanceProfile,
  startupReadyShellArg
} from "./shared.js";

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

export function buildStartupReadyOperatorCommands(
  run: StartupReadinessRun
): StartupReadyOperatorCommand[] {
  const cwd = startupReadyShellArg(run.cwd);
  const governanceProfile = startupReadinessRunGovernanceProfile(run);
  const readyCommand = [
    "runstead startup ready",
    `--cwd ${cwd}`,
    `--stage ${run.stage}`,
    `--target ${run.target}`,
    `--worker ${run.worker}`,
    `--governance ${governanceProfile}`,
    ...(run.scaffoldProfile?.template === undefined
      ? []
      : [`--app-template ${run.scaffoldProfile.template}`]),
    ...(run.scaffoldProfile?.appType === undefined
      ? []
      : [`--app-type ${run.scaffoldProfile.appType}`])
  ].join(" ");
  const commands: StartupReadyOperatorCommand[] = [
    {
      kind: "resume",
      title: "Resume this readiness run",
      command: `runstead startup ready --cwd ${cwd} --resume ${run.id}`,
      when: "Continue the same run after an interruption, approval, or manual evidence update."
    },
    {
      kind: "rerun",
      title: "Run the same readiness gate again",
      command: readyCommand,
      when: "Re-evaluate after code, evidence, or configuration changes."
    },
    {
      kind: "dashboard",
      title: "Rebuild the local dashboard",
      command: `runstead dashboard build --cwd ${cwd}`,
      when: "Refresh the local HTML/JSON control-plane view for this workspace."
    },
    {
      kind: "complete_check",
      title: "Run complete-product audit",
      command: `runstead startup complete-check --cwd ${cwd} --target ${run.target}`,
      when: "Verify launch report, CI gate, dashboard, diagnostics, remediation, evidence, and events."
    }
  ];

  if (startupReadyVerifierOnlyRecoveryAvailable(run)) {
    commands.unshift({
      kind: "recover",
      title: "Recover with verifier-only evaluation",
      command: `runstead startup ready --cwd ${cwd} --resume ${run.id}`,
      when: "Runstead can recover without re-running the agent because current verifier evidence exists."
    });
  }

  if (
    run.target !== "local" ||
    run.verdictBlockers.some((blocker) => blocker.toLowerCase().includes("ci"))
  ) {
    commands.splice(2, 0, {
      kind: "ci",
      title: "Attach CI summary evidence",
      command: `${readyCommand} --ci`,
      when: "Record CI summary artifacts for staging or production readiness evidence."
    });
  }

  return commands;
}

export function startupReadyVerifierOnlyRecoveryAvailable(
  run: StartupReadinessRun
): boolean {
  const build = run.phases.find((phase) => phase.id === "build_mvp");
  const verifiers = run.phases.find((phase) => phase.id === "verifiers");

  if (build === undefined || verifiers?.status !== "passed") {
    return false;
  }

  return (
    build.status === "failed" ||
    build.status === "blocked" ||
    build.warnings?.some((warning) =>
      warning.toLowerCase().includes("recovered without re-running the agent")
    ) === true ||
    build.nextAction?.toLowerCase().includes("without re-running the agent") === true
  );
}

export function startupReadyGuidedStepForPhase(
  run: StartupReadinessRun,
  phase: StartupReadinessRunPhase,
  index: number
): StartupReadyGuidedStep {
  const blocker = phase.blockers[0] ?? `${phase.title} has not completed successfully`;

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
  if (input.resolution === "agent") {
    return `runstead startup ready --cwd ${input.run.cwd} --resume ${input.run.id}`;
  }

  if (input.blocker.toLowerCase().includes("ci")) {
    return `runstead startup ready --cwd ${input.run.cwd} --stage ${input.run.stage} --target ${input.run.target} --ci`;
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

export function formatStartupReadyOperatorCommandLines(
  commands: StartupReadyOperatorCommand[]
): string[] {
  return commands.map((item) => `- ${item.title}: ${item.command} (${item.when})`);
}
