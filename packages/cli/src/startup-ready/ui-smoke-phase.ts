import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveRunsteadRoot } from "../runstead-root.js";
import {
  executeStartupReadyUiSmoke,
  type StartupReadyUiSmokeCheckResult,
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

export interface StartupReadyUiSmokeRepairAttempt {
  uiSmoke: StartupReadyUiSmokeRunResult;
  artifacts: string[];
  blockers: string[];
  attempts: StartupReadyUiSmokeRepairAttemptSummary[];
  stoppedReason?: string;
  verifierUpdate?: Partial<StartupReadinessRunPhase>;
}

export interface StartupReadyUiSmokeRepairAttemptSummary {
  attempt: number;
  signature: string;
  workerStatus: string;
  verifierStatus: string;
  uiSmokeStatus: string;
  codeChanged: boolean;
  evidenceIds: string[];
  stoppedReason?: string;
}

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

export function startupReadyUiSmokeRepairWarnings(
  repair: StartupReadyUiSmokeRepairAttempt
): string[] {
  return [
    ...repair.attempts.map(
      (attempt) =>
        `UI smoke repair attempt ${attempt.attempt}: signature=${attempt.signature}; worker=${attempt.workerStatus}; verifiers=${attempt.verifierStatus}; ui=${attempt.uiSmokeStatus}; codeChanged=${attempt.codeChanged}; evidence=${attempt.evidenceIds.length}`
    ),
    ...(repair.stoppedReason === undefined ? [] : [repair.stoppedReason])
  ];
}

export function startupReadyUiSmokeRepairTarget(
  uiSmoke: StartupReadyUiSmokeRunResult
): StartupReadyUiSmokeCheckResult | undefined {
  return uiSmoke.checks.find((check) => {
    if (check.status !== "failed") {
      return false;
    }

    return (
      check.failureCategory !== "browser_runtime" && check.failureCategory !== "network"
    );
  });
}

export async function startupReadyUiSmokeFailureSignature(
  check: StartupReadyUiSmokeCheckResult
): Promise<string> {
  const artifactHash =
    check.artifact === undefined
      ? "artifact:missing"
      : `artifact:${await sha256FileOrValue(check.artifact)}`;
  const basis = JSON.stringify({
    name: check.name,
    category: check.failureCategory ?? "unknown",
    summary: check.failureSummary ?? "unknown",
    action: check.failedAction ?? null,
    artifactHash
  });

  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

export async function sha256FileOrValue(path: string): Promise<string> {
  try {
    return createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  } catch {
    return createHash("sha256").update(path).digest("hex");
  }
}

export async function writeStartupReadyUiSmokeRepairRequest(input: {
  run: StartupReadinessRun;
  uiSmoke: StartupReadyUiSmokeRunResult;
  target: StartupReadyUiSmokeCheckResult;
  attempt: number;
  maxAttempts: number;
  signature: string;
  now?: Date;
}): Promise<string> {
  const root = await resolveRunsteadRoot(input.run.cwd);
  const dir = join(root.root, "startup");
  const path = join(
    dir,
    `ui-smoke-repair-${input.run.id}-attempt-${input.attempt}.json`
  );

  await mkdir(dir, { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        runId: input.run.id,
        phase: "ui_smoke",
        configPath: input.uiSmoke.configPath,
        attempt: input.attempt,
        maxAttempts: input.maxAttempts,
        failureSignature: input.signature,
        check: input.target.name,
        failureCategory: input.target.failureCategory ?? "unknown",
        failureSummary: input.target.failureSummary ?? "unknown",
        failedAction: input.target.failedAction ?? null,
        domArtifact: input.target.artifact ?? null,
        repairHint: input.target.repairHint ?? null,
        generatedAt: (input.now ?? new Date()).toISOString()
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return path;
}

export function startupReadyUiSmokeRepairPrompt(input: {
  run: StartupReadinessRun;
  uiSmoke: StartupReadyUiSmokeRunResult;
  target: StartupReadyUiSmokeCheckResult;
  repairArtifact: string;
  attempt: number;
  maxAttempts: number;
  signature: string;
}): string {
  return [
    "Repair the product or UI smoke configuration for a failed Runstead UI smoke check.",
    "Keep the patch scoped to the failing UI flow. Do not add or upgrade dependencies.",
    "Prefer stable product selectors such as data-testid for core todo interactions.",
    "",
    `Run: ${input.run.id}`,
    `Repair attempt: ${input.attempt}/${input.maxAttempts}`,
    `Failure signature: ${input.signature}`,
    `UI smoke config: ${input.uiSmoke.configPath}`,
    `Repair artifact: ${input.repairArtifact}`,
    `Check: ${input.target.name}`,
    `Failure category: ${input.target.failureCategory ?? "unknown"}`,
    `Failure summary: ${input.target.failureSummary ?? "unknown"}`,
    `DOM snapshot artifact: ${input.target.artifact ?? "unavailable"}`,
    `Repair hint: ${input.target.repairHint ?? "none"}`,
    "",
    "Failed action:",
    JSON.stringify(input.target.failedAction ?? null, null, 2),
    "",
    "After applying the smallest repair, leave test/lint/typecheck/build verifiers green. Runstead will rerun UI smoke automatically."
  ].join("\n");
}
