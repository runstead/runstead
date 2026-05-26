import { createLocalAgentTask } from "../local-agent.js";
import type { StartupExtensionExecutionResult } from "../startup-extension-execution.js";
import type { startupBuildMvp } from "../startup-founder-flow.js";
import { runTaskVerifiers, type RunTaskVerifiersResult } from "../verifier-runner.js";
import {
  collectCurrentStartupReadyVerifierEvidence,
  startupReadyVerifierCommands
} from "./verifier-current-evidence.js";
import type { StartupReadyMvpBuildExecution } from "./build-mvp-phase.js";
import type {
  StartupReadinessRun,
  StartupReadinessRunPhase,
  StartupReadyOptions
} from "./types.js";
import { unique } from "./shared.js";

export {
  collectCurrentStartupReadyVerifierEvidence,
  currentStartupReadyVerifierEvidenceMatch,
  startupReadyVerifierCommands,
  type CurrentStartupReadyVerifierEvidence,
  type CurrentStartupReadyVerifierEvidenceMatch
} from "./verifier-current-evidence.js";

export type StartupMvpVerifierRun = Awaited<
  ReturnType<typeof startupBuildMvp>
>["verifierRun"];

export async function runStartupReadyGreenPathVerifiers(
  run: StartupReadinessRun,
  options: StartupReadyOptions
): Promise<{ verifierRun: StartupMvpVerifierRun }> {
  const created = await createLocalAgentTask({
    cwd: run.cwd,
    title: "Verify existing startup MVP",
    prompt:
      "Verify the existing AI-coded MVP with repository commands. Do not invoke an editing agent.",
    worker: run.worker,
    mode: "read-only",
    verifierCommands: await startupReadyVerifierCommands(run.cwd, options.now),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const verified = await runTaskVerifiers({
    cwd: run.cwd,
    taskId: created.task.id,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    verifierRun: startupMvpVerifierRunFromTaskVerifiers(verified)
  };
}

export function startupMvpVerifierRunFromTaskVerifiers(
  result: RunTaskVerifiersResult
): StartupMvpVerifierRun {
  const failed = result.commandResults.some(
    (command) => command.exitCode !== 0 || command.timedOut
  );

  return {
    status: failed ? "failed" : "completed",
    taskId: result.task.id,
    commandResults: result.commandResults
  };
}

export function startupMvpVerifierRunPassed(run: StartupMvpVerifierRun): boolean {
  return (
    run.status === "completed" &&
    run.commandResults.length > 0 &&
    run.commandResults.every(
      (command) => command.exitCode === 0 && command.timedOut === false
    )
  );
}

export function mergeStartupVerifierPhaseUpdate(
  run: StartupReadinessRun,
  update: Partial<StartupReadinessRunPhase>
): Partial<StartupReadinessRunPhase> {
  const current = run.phases.find((phase) => phase.id === "verifiers");

  return {
    ...update,
    evidenceIds: unique([
      ...(current?.evidenceIds ?? []),
      ...(update.evidenceIds ?? [])
    ]),
    artifacts: unique([...(current?.artifacts ?? []), ...(update.artifacts ?? [])]),
    blockers:
      update.status === "passed"
        ? []
        : unique([...(current?.blockers ?? []), ...(update.blockers ?? [])])
  };
}

export function verifierPhaseUpdate(
  run: Awaited<ReturnType<typeof startupBuildMvp>>["verifierRun"]
): Partial<StartupReadinessRunPhase> {
  if (run.status === "skipped") {
    return {
      status: "skipped",
      blockers: [run.reason],
      nextAction: "run startup ready again after the MVP worker completes"
    };
  }

  const failed = run.commandResults.filter(
    (result) => result.exitCode !== 0 || result.timedOut
  );

  return {
    status: run.status === "completed" ? "passed" : "blocked",
    evidenceIds: run.commandResults.map((result) => result.evidenceId),
    blockers: failed.map((result) => `${result.verifier} verifier failed`),
    nextAction:
      failed.length === 0
        ? "continue launch readiness"
        : "repair verifier failures and rerun startup ready"
  };
}

export async function startupReadyVerifierPhaseUpdate(
  run: StartupReadinessRun,
  build: StartupReadyMvpBuildExecution,
  options: StartupReadyOptions
): Promise<{
  update: Partial<StartupReadinessRunPhase>;
  verifiedByCurrentEvidence: boolean;
}> {
  if (build.verifierRun.status !== "skipped") {
    return {
      update: verifierPhaseUpdate(build.verifierRun),
      verifiedByCurrentEvidence: false
    };
  }

  const currentEvidence = await collectCurrentStartupReadyVerifierEvidence(run.cwd, {
    ...(options.now === undefined ? {} : { now: options.now })
  });

  if (currentEvidence.expectedVerifierNames.length === 0) {
    return {
      update: verifierPhaseUpdate(build.verifierRun),
      verifiedByCurrentEvidence: false
    };
  }

  const blockers = [
    ...currentEvidence.failed.map(
      (evidence) =>
        `${evidence.verifier} verifier evidence failed for current code fingerprint`
    ),
    ...currentEvidence.missingVerifierNames.map(
      (verifier) =>
        `${verifier} verifier evidence is missing for current code fingerprint`
    )
  ];

  if (blockers.length > 0) {
    return {
      update: {
        status: "blocked",
        evidenceIds: currentEvidence.passed.map((evidence) => evidence.evidenceId),
        blockers,
        warnings:
          currentEvidence.passed.length === 0
            ? []
            : [
                "partial current verifier evidence recovered after worker completion failure"
              ],
        nextAction:
          "run missing or failing verifier evidence for the current code fingerprint and resume startup readiness"
      },
      verifiedByCurrentEvidence: false
    };
  }

  return {
    update: {
      status: "passed",
      evidenceIds: currentEvidence.passed.map((evidence) => evidence.evidenceId),
      blockers: [],
      warnings: [
        "verified despite agent completion failure using current code fingerprint verifier evidence"
      ],
      nextAction: "current verifier evidence proves the MVP; continue launch readiness"
    },
    verifiedByCurrentEvidence: true
  };
}

export function startupReadyExtensionWarnings(
  result: StartupExtensionExecutionResult
): string[] {
  return unique([
    ...result.warnings,
    ...result.collectorResults.flatMap((collector) =>
      collector.status === "skipped"
        ? [
            `extension ${collector.extensionId}/${collector.collectorId} collector skipped`
          ]
        : []
    )
  ]);
}
