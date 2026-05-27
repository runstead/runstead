import type { StartupReadyOperatorCommand, StartupReadinessRun } from "./types.js";
import {
  startupReadinessRunGovernanceProfile,
  startupReadyShellArg
} from "./shared.js";
import {
  startupReadySourceConnectorBlocker,
  startupReadySourcePlanCommand
} from "./source-guidance.js";

export {
  buildStartupReadyGuidedFlow,
  formatStartupReadyGuidedFlowLines,
  startupReadyGuidedCommand,
  startupReadyGuidedNextAction,
  startupReadyGuidedResolution,
  startupReadyGuidedStepForBlocker,
  startupReadyGuidedStepForPhase,
  startupReadyGuidedWhy
} from "./operator-guided-flow.js";

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

  if (run.target !== "local" || startupReadyHasSourceConnectorBlocker(run)) {
    commands.splice(2, 0, {
      kind: "source_plan",
      title: "Plan source connector refresh",
      command: startupReadySourcePlanCommand(run),
      when: "Show required external source connector evidence, credential blockers, and refresh commands for this target."
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

function startupReadyHasSourceConnectorBlocker(run: StartupReadinessRun): boolean {
  return run.verdictBlockers.some(startupReadySourceConnectorBlocker);
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

export function formatStartupReadyOperatorCommandLines(
  commands: StartupReadyOperatorCommand[]
): string[] {
  return commands.map((item) => `- ${item.title}: ${item.command} (${item.when})`);
}
