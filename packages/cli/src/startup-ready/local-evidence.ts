import { addStartupEvidence, checkStartupGate } from "../startup-evidence.js";
import type { StartupReadinessRun } from "./types.js";
import { collectRecordedStartupReadinessEvidence } from "./evidence.js";
import {
  startupReadyLocalLaunchEvidenceInputs,
  startupReadyLocalMvpEvidenceInputs,
  type LocalReadinessEvidenceInput
} from "./local-evidence-inputs.js";
import { hasPhase, phaseStatus } from "./shared.js";

export async function ensureStartupReadyLocalMvpEvidence(
  run: StartupReadinessRun,
  now: Date
): Promise<void> {
  const evidenceTypes = new Set(
    (await collectRecordedStartupReadinessEvidence(run.cwd, { now })).evidenceTypes
  );
  const gate = await checkStartupGate({
    cwd: run.cwd,
    stage: "mvp",
    now,
    recordEvent: false
  });

  for (const input of startupReadyLocalMvpEvidenceInputs(run, now, gate.blockers)) {
    await addLocalReadinessEvidenceIfMissing(evidenceTypes, input);
  }
}

export async function ensureStartupReadyLocalLaunchEvidence(
  run: StartupReadinessRun,
  now: Date
): Promise<void> {
  if (phaseStatus(run, "verifiers") !== "passed") {
    return;
  }

  if (hasPhase(run, "ui_smoke") && phaseStatus(run, "ui_smoke") !== "passed") {
    return;
  }

  const evidenceTypes = new Set(
    (await collectRecordedStartupReadinessEvidence(run.cwd, { now })).evidenceTypes
  );
  const gate = await checkStartupGate({
    cwd: run.cwd,
    stage: "launch",
    now,
    recordEvent: false
  });

  for (const input of startupReadyLocalLaunchEvidenceInputs(run, now, gate.blockers)) {
    await addLocalReadinessEvidenceIfMissing(evidenceTypes, input);
  }
}

export async function addLocalReadinessEvidenceIfMissing(
  evidenceTypes: Set<string>,
  input: LocalReadinessEvidenceInput
): Promise<void> {
  const storedType = `startup_${input.type}`;

  if (input.force !== true && evidenceTypes.has(storedType)) {
    return;
  }

  await addStartupEvidence({
    cwd: input.cwd,
    type: input.type,
    summary: input.summary,
    sourceRefs: input.sourceRefs,
    ...(input.sources === undefined ? {} : { sources: input.sources }),
    content: JSON.stringify(input.content, null, 2),
    gate: input.gate,
    ...(input.owner === undefined ? {} : { owner: input.owner }),
    ...(input.remediationTask === undefined
      ? {}
      : { remediationTask: input.remediationTask }),
    ...(input.acceptanceCriteria === undefined
      ? {}
      : { acceptanceCriteria: input.acceptanceCriteria }),
    now: input.now
  });
  evidenceTypes.add(storedType);
}
