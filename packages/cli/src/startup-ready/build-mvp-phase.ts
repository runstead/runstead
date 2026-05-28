import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeExecutionSemantics } from "@runstead/runtime";

import { resolveRunsteadRoot } from "../runstead-root.js";
import { checkStartupGate } from "../startup-evidence.js";
import { startupBuildMvp } from "../startup-founder-flow.js";
import type {
  StartupReadinessRun,
  StartupReadinessRunPhase,
  StartupReadyOptions
} from "./types.js";
import { unique } from "./shared.js";
import type { StartupReadyGreenPathPreflight } from "./build-mvp-preflight.js";
import {
  runStartupReadyGreenPathVerifiers,
  startupMvpVerifierRunPassed,
  type StartupMvpVerifierRun
} from "./verifier-phase.js";
export {
  hasStartupReadyApplicationSurface,
  hasStartupReadyUiSmokeConfig,
  startupReadyGreenPathPreflight,
  type StartupReadyGreenPathPreflight
} from "./build-mvp-preflight.js";

export interface StartupReadyMvpBuildExecution {
  status: StartupBuildMvpResultStatus;
  execution: RuntimeExecutionSemantics;
  verifierRun: StartupMvpVerifierRun;
  gate: Awaited<ReturnType<typeof checkStartupGate>>;
  agentSkipped: boolean;
}

export async function writeStartupScaffoldProfileArtifact(
  run: StartupReadinessRun
): Promise<string | undefined> {
  if (run.scaffoldProfile === undefined) {
    return undefined;
  }

  const root = await resolveRunsteadRoot(run.cwd);
  const path = join(root.root, "startup", "scaffold-profile.json");

  await mkdir(join(root.root, "startup"), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        runId: run.id,
        target: run.target,
        worker: run.worker,
        profile: run.scaffoldProfile
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return path;
}

export async function executeStartupReadyMvpBuild(input: {
  run: StartupReadinessRun;
  options: StartupReadyOptions;
  greenPath: StartupReadyGreenPathPreflight;
}): Promise<StartupReadyMvpBuildExecution> {
  if (input.greenPath.ok) {
    const verified = await runStartupReadyGreenPathVerifiers(input.run, input.options);

    if (startupMvpVerifierRunPassed(verified.verifierRun)) {
      return {
        status: "completed",
        execution: {
          implementation: "no_change_needed",
          verification: "passed",
          agentCompletion: "completed"
        },
        verifierRun: verified.verifierRun,
        gate: await checkStartupGate({
          cwd: input.run.cwd,
          stage: "mvp",
          ...(input.options.now === undefined ? {} : { now: input.options.now })
        }),
        agentSkipped: true
      };
    }
  }

  const build = await startupBuildMvp({
    cwd: input.run.cwd,
    worker: input.run.worker,
    dependencyPolicy: "deny-new",
    maxAttempts: input.options.maxAttempts ?? 2,
    ...(input.run.scaffoldProfile === undefined
      ? {}
      : { scaffoldProfile: input.run.scaffoldProfile }),
    ...(input.options.workerRunner === undefined
      ? {}
      : { workerRunner: input.options.workerRunner }),
    ...(input.options.now === undefined ? {} : { now: input.options.now })
  });

  return {
    status: build.status,
    execution: build.execution,
    verifierRun: build.verifierRun,
    gate: build.gate,
    agentSkipped: false
  };
}

export type StartupBuildMvpResultStatus = Awaited<
  ReturnType<typeof startupBuildMvp>
>["status"];

export function startupBuildMvpPhaseExecutionStatus(
  status: StartupBuildMvpResultStatus,
  execution?: RuntimeExecutionSemantics
): "passed" | "failed" {
  if (
    execution?.verification === "passed" &&
    (execution.implementation === "applied" ||
      execution.implementation === "no_change_needed")
  ) {
    return "passed";
  }

  return status === "completed" || status === "completed_with_warnings"
    ? "passed"
    : "failed";
}

export function startupReadyAutoRecoverBuildMvp(input: {
  status: "passed" | "failed";
  execution: RuntimeExecutionSemantics;
  verifierPhase: Partial<StartupReadinessRunPhase>;
}): {
  status: "passed" | "failed";
  execution: RuntimeExecutionSemantics;
  recovered: boolean;
} {
  if (
    input.status === "passed" ||
    input.verifierPhase.status !== "passed" ||
    input.verifierPhase.evidenceIds === undefined ||
    input.verifierPhase.evidenceIds.length === 0
  ) {
    return {
      status: input.status,
      execution: input.execution,
      recovered: false
    };
  }

  return {
    status: "passed",
    execution: {
      implementation:
        input.execution.implementation === "applied" ? "applied" : "no_change_needed",
      verification: "passed",
      agentCompletion: input.execution.agentCompletion
    },
    recovered: true
  };
}

export function startupBuildMvpPhaseExecutionWarnings(
  execution: RuntimeExecutionSemantics,
  options: {
    verifiedByCurrentEvidence?: boolean;
    verifierOnlyRecovery?: boolean;
  } = {}
): string[] {
  return unique([
    ...(execution.verification === "passed" && execution.agentCompletion !== "completed"
      ? [
          `MVP verification passed after agent completion reported ${execution.agentCompletion}`
        ]
      : []),
    ...(options.verifiedByCurrentEvidence === true &&
    execution.agentCompletion !== "completed"
      ? [
          `MVP verified despite agent completion failure using current code fingerprint evidence`
        ]
      : []),
    ...(options.verifierOnlyRecovery === true
      ? [
          "Runstead recovered without re-running the agent using current verifier evidence"
        ]
      : [])
  ]);
}
