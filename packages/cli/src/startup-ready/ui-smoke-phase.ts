import {
  executeStartupReadyUiSmoke,
  type StartupReadyUiSmokeRunResult
} from "../startup-ready-ui-smoke.js";
import { startupBuildMvp } from "../startup-founder-flow.js";
import { collectCommandVerifierCodeState } from "../verifier-evidence.js";
import { STARTUP_READY_UI_SMOKE_REPAIR_MAX_ATTEMPTS } from "./constants.js";
import { startupBuildMvpPhaseExecutionStatus } from "./build-mvp-phase.js";
import type {
  StartupReadinessRun,
  StartupReadinessRunPhase,
  StartupReadyOptions
} from "./types.js";
import { unique } from "./shared.js";
import { emitStartupReadyProgress } from "./progress.js";
import {
  mergeStartupVerifierPhaseUpdate,
  verifierPhaseUpdate
} from "./verifier-phase.js";
import {
  startupReadyUiSmokeFailureSignature,
  startupReadyUiSmokeRepairPrompt,
  startupReadyUiSmokeRepairTarget,
  writeStartupReadyUiSmokeRepairRequest,
  type StartupReadyUiSmokeRepairAttempt,
  type StartupReadyUiSmokeRepairAttemptSummary
} from "./ui-smoke-repair-helpers.js";

export {
  sha256FileOrValue,
  startupReadyUiSmokeFailureSignature,
  startupReadyUiSmokeRepairPrompt,
  startupReadyUiSmokeRepairTarget,
  startupReadyUiSmokeRepairWarnings,
  writeStartupReadyUiSmokeRepairRequest,
  type StartupReadyUiSmokeRepairAttempt,
  type StartupReadyUiSmokeRepairAttemptSummary
} from "./ui-smoke-repair-helpers.js";

export async function attemptStartupReadyUiSmokeRepair(
  run: StartupReadinessRun,
  options: StartupReadyOptions,
  uiSmoke: StartupReadyUiSmokeRunResult
): Promise<StartupReadyUiSmokeRepairAttempt | undefined> {
  let currentUiSmoke = uiSmoke;
  let target = startupReadyUiSmokeRepairTarget(currentUiSmoke);

  if (target === undefined) {
    return undefined;
  }

  const artifacts = [...uiSmoke.artifacts];
  const attempts: StartupReadyUiSmokeRepairAttemptSummary[] = [];
  const seenSignatures = new Set<string>();
  let verifierUpdate: Partial<StartupReadinessRunPhase> | undefined;
  let stoppedReason: string | undefined;

  for (
    let attempt = 1;
    attempt <= STARTUP_READY_UI_SMOKE_REPAIR_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const signature = await startupReadyUiSmokeFailureSignature(target);

    if (seenSignatures.has(signature)) {
      stoppedReason = `UI smoke repair stopped before attempt ${attempt}: repeated failure signature ${signature}`;
      break;
    }

    seenSignatures.add(signature);

    const beforeCodeState = await collectCommandVerifierCodeState(run.cwd);
    const repairArtifact = await writeStartupReadyUiSmokeRepairRequest({
      run,
      uiSmoke: currentUiSmoke,
      target,
      attempt,
      signature,
      maxAttempts: STARTUP_READY_UI_SMOKE_REPAIR_MAX_ATTEMPTS,
      ...(options.now === undefined ? {} : { now: options.now })
    });

    artifacts.push(repairArtifact);
    emitStartupReadyProgress(run, options, {
      phaseId: "ui_smoke",
      status: "started",
      message: `attempting automatic UI smoke repair ${attempt}/${STARTUP_READY_UI_SMOKE_REPAIR_MAX_ATTEMPTS}`,
      artifacts: [repairArtifact]
    });

    const build = await startupBuildMvp({
      cwd: run.cwd,
      worker: run.worker,
      dependencyPolicy: "deny-new",
      maxAttempts: 1,
      ...(run.scaffoldProfile === undefined
        ? {}
        : { scaffoldProfile: run.scaffoldProfile }),
      prompt: startupReadyUiSmokeRepairPrompt({
        run,
        uiSmoke: currentUiSmoke,
        target,
        repairArtifact,
        attempt,
        maxAttempts: STARTUP_READY_UI_SMOKE_REPAIR_MAX_ATTEMPTS,
        signature
      }),
      ...(options.workerRunner === undefined
        ? {}
        : { workerRunner: options.workerRunner }),
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const afterCodeState = await collectCommandVerifierCodeState(run.cwd);
    const codeChanged = beforeCodeState.fingerprint !== afterCodeState.fingerprint;
    const currentVerifierUpdate = verifierPhaseUpdate(build.verifierRun);
    const verified =
      startupBuildMvpPhaseExecutionStatus(build.status, build.execution) === "passed" &&
      currentVerifierUpdate.status === "passed";
    verifierUpdate = mergeStartupVerifierPhaseUpdate(run, currentVerifierUpdate);
    currentUiSmoke = verified
      ? await executeStartupReadyUiSmoke({
          cwd: run.cwd,
          ...(options.now === undefined ? {} : { now: options.now })
        })
      : currentUiSmoke;
    const summary: StartupReadyUiSmokeRepairAttemptSummary = {
      attempt,
      signature,
      workerStatus: build.status,
      verifierStatus: build.verifierRun.status,
      uiSmokeStatus: currentUiSmoke.status,
      codeChanged,
      evidenceIds: currentUiSmoke.evidenceIds
    };

    attempts.push(summary);

    if (!verified) {
      stoppedReason = `automatic UI smoke repair stopped after attempt ${attempt}: worker=${build.status}; verifiers=${build.verifierRun.status}`;
      attempts[attempts.length - 1] = {
        ...summary,
        stoppedReason
      };
      break;
    }

    if (currentUiSmoke.status === "passed") {
      return {
        uiSmoke: currentUiSmoke,
        artifacts: unique([...artifacts, ...currentUiSmoke.artifacts]),
        blockers: [],
        attempts,
        verifierUpdate
      };
    }

    const nextTarget = startupReadyUiSmokeRepairTarget(currentUiSmoke);

    if (nextTarget === undefined) {
      stoppedReason = `automatic UI smoke repair stopped after attempt ${attempt}: remaining UI smoke failure is not product-repairable`;
      attempts[attempts.length - 1] = {
        ...summary,
        stoppedReason
      };
      break;
    }

    const nextSignature = await startupReadyUiSmokeFailureSignature(nextTarget);

    if (nextSignature === signature && !codeChanged) {
      stoppedReason = `automatic UI smoke repair stopped after attempt ${attempt}: repeated failure signature without a code diff`;
      attempts[attempts.length - 1] = {
        ...summary,
        stoppedReason
      };
      break;
    }

    if (nextSignature === signature && currentUiSmoke.evidenceIds.length === 0) {
      stoppedReason = `automatic UI smoke repair stopped after attempt ${attempt}: repeated failure signature without new evidence`;
      attempts[attempts.length - 1] = {
        ...summary,
        stoppedReason
      };
      break;
    }

    target = nextTarget;
  }

  return {
    uiSmoke: currentUiSmoke,
    artifacts: unique([...artifacts, ...currentUiSmoke.artifacts]),
    blockers: [
      stoppedReason ??
        `automatic UI smoke repair exhausted ${STARTUP_READY_UI_SMOKE_REPAIR_MAX_ATTEMPTS} attempts`
    ],
    attempts,
    ...(stoppedReason === undefined ? {} : { stoppedReason }),
    ...(verifierUpdate === undefined ? {} : { verifierUpdate })
  };
}
