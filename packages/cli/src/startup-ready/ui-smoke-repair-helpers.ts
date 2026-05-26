import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveRunsteadRoot } from "../runstead-root.js";
import type {
  StartupReadyUiSmokeCheckResult,
  StartupReadyUiSmokeRunResult
} from "../startup-ready-ui-smoke.js";
import type { StartupReadinessRun, StartupReadinessRunPhase } from "./types.js";

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

export function startupReadyUiSmokeRepairWarnings(
  repair: StartupReadyUiSmokeRepairAttempt
): string[] {
  return [
    ...repair.attempts.map(
      (attempt: StartupReadyUiSmokeRepairAttemptSummary) =>
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
