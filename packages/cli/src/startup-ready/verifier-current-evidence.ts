import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { collectRepoInspection } from "../inspection-evidence.js";
import { requireRunsteadStateDb } from "../runstead-root.js";
import { startupReadinessExtensionVerifierCommands } from "../startup-extension-loader.js";
import { collectCommandVerifierCodeState } from "../verifier-evidence.js";
import {
  readStartupReadinessEvidenceArtifact,
  type StartupReadinessEvidenceRow
} from "./evidence.js";
import { unique } from "./shared.js";
import {
  currentStartupReadyVerifierEvidenceMatch,
  type CurrentStartupReadyVerifierEvidenceMatch
} from "./verifier-current-evidence-match.js";

export {
  currentStartupReadyVerifierEvidenceMatch,
  type CurrentStartupReadyVerifierEvidenceMatch
} from "./verifier-current-evidence-match.js";

export interface CurrentStartupReadyVerifierEvidence {
  expectedVerifierNames: string[];
  passed: CurrentStartupReadyVerifierEvidenceMatch[];
  failed: CurrentStartupReadyVerifierEvidenceMatch[];
  missingVerifierNames: string[];
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
