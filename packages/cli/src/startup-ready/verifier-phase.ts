import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { collectRepoInspection } from "../inspection-evidence.js";
import { createLocalAgentTask } from "../local-agent.js";
import { requireRunsteadStateDb } from "../runstead-root.js";
import type { StartupExtensionExecutionResult } from "../startup-extension-execution.js";
import { startupReadinessExtensionVerifierCommands } from "../startup-extension-loader.js";
import type { startupBuildMvp } from "../startup-founder-flow.js";
import { collectCommandVerifierCodeState } from "../verifier-evidence.js";
import { runTaskVerifiers, type RunTaskVerifiersResult } from "../verifier-runner.js";
import {
  readStartupReadinessEvidenceArtifact,
  type StartupReadinessEvidenceRow
} from "./evidence.js";
import type { StartupReadyMvpBuildExecution } from "./build-mvp-phase.js";
import type {
  StartupReadinessRun,
  StartupReadinessRunPhase,
  StartupReadyOptions
} from "./types.js";
import { isRecord, stringValue, unique } from "./shared.js";

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

export async function startupReadyVerifierCommands(
  cwd: string,
  now?: Date
): Promise<{ name: string; command: string }[]> {
  const inspection = await collectRepoInspection(
    cwd,
    (now ?? new Date()).toISOString()
  );

  const standard = [
    { name: "test", command: inspection.commands.test.command },
    { name: "lint", command: inspection.commands.lint.command },
    { name: "typecheck", command: inspection.commands.typecheck.command },
    { name: "build", command: inspection.commands.build.command }
  ].flatMap((item) =>
    item.command === undefined ? [] : [{ name: item.name, command: item.command }]
  );
  const extensionCommands = await startupReadinessExtensionVerifierCommands({ cwd });

  return [...standard, ...extensionCommands];
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

export interface CurrentStartupReadyVerifierEvidence {
  expectedVerifierNames: string[];
  passed: CurrentStartupReadyVerifierEvidenceMatch[];
  failed: CurrentStartupReadyVerifierEvidenceMatch[];
  missingVerifierNames: string[];
}

export interface CurrentStartupReadyVerifierEvidenceMatch {
  verifier: string;
  evidenceId: string;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  forceKilled: boolean;
  createdAt: string;
}

export async function collectCurrentStartupReadyVerifierEvidence(
  cwd: string,
  options: { now?: Date } = {}
): Promise<CurrentStartupReadyVerifierEvidence> {
  const expectedVerifierNames = unique(
    (await startupReadyVerifierCommands(cwd, options.now)).map(
      (command) => command.name
    )
  );

  if (expectedVerifierNames.length === 0) {
    return {
      expectedVerifierNames,
      passed: [],
      failed: [],
      missingVerifierNames: []
    };
  }

  const codeState = await collectCommandVerifierCodeState(cwd);
  const expected = new Set(expectedVerifierNames);
  const latestByVerifier = new Map<string, CurrentStartupReadyVerifierEvidenceMatch>();

  try {
    const state = await requireRunsteadStateDb(cwd);
    const database = openRunsteadDatabase(state.stateDb);

    try {
      const rows = database
        .prepare(
          `
          SELECT id, type, uri, summary, created_at AS createdAt
          FROM evidence
          WHERE type = 'command_output'
          `
        )
        .all() as unknown as StartupReadinessEvidenceRow[];
      const artifacts = await Promise.all(
        rows.map((row) => readStartupReadinessEvidenceArtifact(row.uri))
      );

      rows.forEach((row, index) => {
        const match = currentStartupReadyVerifierEvidenceMatch({
          row,
          artifact: artifacts[index],
          expected,
          codeFingerprint: codeState.fingerprint
        });

        if (match === undefined) {
          return;
        }

        const current = latestByVerifier.get(match.verifier);

        if (
          current === undefined ||
          Date.parse(match.createdAt) > Date.parse(current.createdAt) ||
          (match.createdAt === current.createdAt &&
            match.evidenceId.localeCompare(current.evidenceId) > 0)
        ) {
          latestByVerifier.set(match.verifier, match);
        }
      });
    } finally {
      database.close();
    }
  } catch {
    return {
      expectedVerifierNames,
      passed: [],
      failed: [],
      missingVerifierNames: expectedVerifierNames
    };
  }

  const passed: CurrentStartupReadyVerifierEvidenceMatch[] = [];
  const failed: CurrentStartupReadyVerifierEvidenceMatch[] = [];
  const missingVerifierNames: string[] = [];

  expectedVerifierNames.forEach((verifier) => {
    const match = latestByVerifier.get(verifier);

    if (match === undefined) {
      missingVerifierNames.push(verifier);
      return;
    }

    if (
      match.exitCode === 0 &&
      match.timedOut === false &&
      match.forceKilled === false
    ) {
      passed.push(match);
      return;
    }

    failed.push(match);
  });

  return {
    expectedVerifierNames,
    passed,
    failed,
    missingVerifierNames
  };
}

export function currentStartupReadyVerifierEvidenceMatch(input: {
  row: StartupReadinessEvidenceRow;
  artifact: unknown;
  expected: Set<string>;
  codeFingerprint: string;
}): CurrentStartupReadyVerifierEvidenceMatch | undefined {
  if (!isRecord(input.artifact)) {
    return undefined;
  }

  const verifier = stringValue(input.artifact.verifier);

  if (verifier === undefined || !input.expected.has(verifier)) {
    return undefined;
  }

  const codeState = input.artifact.codeState;

  if (
    !isRecord(codeState) ||
    stringValue(codeState.fingerprint) !== input.codeFingerprint
  ) {
    return undefined;
  }

  const result = input.artifact.result;

  if (!isRecord(result)) {
    return undefined;
  }

  const exitCode =
    typeof result.exitCode === "number"
      ? result.exitCode
      : result.exitCode === null
        ? null
        : undefined;

  if (exitCode === undefined || typeof result.timedOut !== "boolean") {
    return undefined;
  }

  return {
    verifier,
    evidenceId: input.row.id,
    command: stringValue(input.artifact.command) ?? "",
    exitCode,
    timedOut: result.timedOut,
    forceKilled: result.forceKilled === true,
    createdAt: input.row.createdAt
  };
}
