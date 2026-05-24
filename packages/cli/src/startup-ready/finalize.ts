import {
  loadStartupReadinessExtensions,
  startupReadinessExtensionEvidenceRequirements,
  startupReadinessExtensionPolicyBlockers
} from "../startup-extension-loader.js";
import type { StartupReadinessEvidenceTier, StartupReadinessRun } from "./types.js";
import { evaluateStartupReadinessVerdict } from "./decision.js";
import { collectRecordedStartupReadinessEvidence } from "./evidence.js";
import {
  collectStartupReadyCodeState,
  inferPhaseEvidenceTiers,
  uniqueEvidenceTiers
} from "./shared.js";

export async function finalizeRun(
  run: StartupReadinessRun,
  now: Date,
  options: { extraEvidenceTiers?: StartupReadinessEvidenceTier[] } = {}
): Promise<StartupReadinessRun> {
  const codeState = await collectStartupReadyCodeState(run.cwd);
  const recordedEvidence = await collectRecordedStartupReadinessEvidence(run.cwd, {
    now,
    codeFingerprint: codeState.fingerprint
  });
  const evidenceTiers = uniqueEvidenceTiers([
    ...inferPhaseEvidenceTiers(run),
    ...recordedEvidence.evidenceTiers,
    ...(options.extraEvidenceTiers ?? [])
  ]);
  const extensions = await loadStartupReadinessExtensions({ cwd: run.cwd });
  const extensionRequirements = startupReadinessExtensionEvidenceRequirements(
    extensions.extensions,
    { stage: run.stage }
  );
  const extensionPolicyBlockers = startupReadinessExtensionPolicyBlockers({
    extensions: extensions.extensions,
    requirements: extensionRequirements,
    target: run.target,
    worker: run.worker,
    governanceProfile: run.governanceProfile
  });
  const extensionLoaderBlockers = [...extensions.issues, ...extensionPolicyBlockers];
  const runForVerdict =
    extensionLoaderBlockers.length === 0
      ? run
      : {
          ...run,
          phases: [
            ...run.phases,
            {
              id: "extensions",
              title: "Extension loader",
              status: "blocked" as const,
              evidenceIds: [],
              artifacts: extensions.discoveredPaths,
              blockers: extensionLoaderBlockers
            }
          ]
        };
  const verdict = evaluateStartupReadinessVerdict({
    run: runForVerdict,
    evidenceTiers,
    evidenceTypes: recordedEvidence.evidenceTypes,
    evidenceRequirements: extensionRequirements,
    staleEvidenceRefs: recordedEvidence.staleEvidenceRefs,
    supersededEvidenceRefs: recordedEvidence.supersededEvidenceRefs
  });
  const phaseStatuses = run.phases.map((phase) => phase.status);
  const status = phaseStatuses.includes("failed")
    ? "failed"
    : phaseStatuses.includes("blocked") || verdict.blockers.length > 0
      ? "blocked"
      : "completed";

  return {
    ...run,
    status,
    evidenceTiers,
    evidenceTypes: recordedEvidence.evidenceTypes,
    evidenceRequirements: extensionRequirements,
    staleEvidenceRefs: recordedEvidence.staleEvidenceRefs,
    supersededEvidenceRefs: recordedEvidence.supersededEvidenceRefs,
    ...(codeState.gitHead === undefined ? {} : { gitHead: codeState.gitHead }),
    dirtyState: codeState.dirtyState,
    dirtyBreakdown: codeState.dirtyBreakdown,
    codeFingerprint: codeState.fingerprint,
    verdict: verdict.verdict,
    verdictBlockers: verdict.blockers,
    completedAt: now.toISOString()
  };
}
