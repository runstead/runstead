import {
  addStartupEvidence,
  checkStartupGate,
  type StartupGateStage
} from "../startup-evidence.js";
import type { StartupReadinessRun } from "./types.js";
import { collectRecordedStartupReadinessEvidence } from "./evidence.js";
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

  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "problem_hypothesis",
    summary:
      "local_manual startup ready baseline: local MVP needs evidence-backed verification before launch.",
    sourceRefs: [`startup-ready:${run.id}:local-baseline`],
    sources: [localStartupReadySource(run.id, now, "manual")],
    content: {
      kind: "problem_hypothesis",
      statement:
        "A locally generated MVP can look complete even when launch evidence, verifiers, and UI smoke are missing.",
      status: "validated",
      confidence: "local_manual"
    },
    gate: "mvp",
    now,
    force: gateNeedsBaselineEvidence(gate.blockers, "problem hypothesis is missing")
  });
  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "user_hypothesis",
    summary:
      "local_manual startup ready baseline: founder-builders are validating this repo for local launch.",
    sourceRefs: [`startup-ready:${run.id}:local-baseline`],
    sources: [localStartupReadySource(run.id, now, "manual")],
    content: {
      kind: "user_hypothesis",
      persona: "founder-builder",
      statement:
        "A founder-builder needs a short local path from agent build to verifiers, UI smoke, launch report, and gate verdict.",
      status: "validated",
      confidence: "local_manual"
    },
    gate: "mvp",
    now,
    force: gateNeedsBaselineEvidence(gate.blockers, "user hypothesis is missing")
  });
  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "solution_hypothesis",
    summary:
      "local_manual startup ready baseline: Runstead local readiness can verify the MVP with scripted evidence.",
    sourceRefs: [`startup-ready:${run.id}:local-baseline`],
    sources: [localStartupReadySource(run.id, now, "manual")],
    content: {
      kind: "solution_hypothesis",
      statement:
        "A local launch-ready MVP should pass repository verifiers, UI smoke, launch audit, launch report, and complete-check.",
      status: "validated",
      confidence: "local_manual"
    },
    gate: "mvp",
    now,
    force: gateNeedsBaselineEvidence(gate.blockers, "solution hypothesis is missing")
  });
  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "disconfirming",
    summary:
      "local_manual startup ready baseline: no blocker-level local disconfirming signal is recorded yet; real-user evidence is still required beyond local launch.",
    sourceRefs: [`startup-ready:${run.id}:local-baseline`],
    sources: [localStartupReadySource(run.id, now, "manual")],
    content: {
      signalsReviewed: ["local repository inspection", "planned verifier run"],
      blockerSignalFound: false,
      limitation:
        "This baseline does not replace customer interviews, real-user analytics, staging traffic, or production support evidence.",
      confidence: "local_manual"
    },
    gate: "mvp",
    now,
    force: gateNeedsBaselineEvidence(gate.blockers, "disconfirming evidence is missing")
  });
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

  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "metric_snapshot",
    summary:
      "local_command startup ready metric snapshot: required local verifiers and UI smoke are passing.",
    sourceRefs: [`startup-ready:${run.id}:verifiers`],
    sources: [localStartupReadySource(run.id, now, "local_command")],
    content: {
      source: "startup_ready_local_verifiers",
      threshold: 1,
      current: 1,
      metric: "local_required_checks_passed",
      sourceClass: "synthetic_smoke",
      confidence: 0.35,
      launchWeight: 0.25,
      realUserData: false,
      captureMode: "local_command",
      verifierPhase: "passed",
      uiSmokePhase: phaseStatus(run, "ui_smoke") ?? "not_included"
    },
    gate: "launch",
    now,
    force: gateNeedsBaselineEvidence(
      gate.blockers,
      "metric snapshot with source, threshold, and current value is missing"
    )
  });
  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "migration_plan",
    summary:
      "local_manual startup ready migration plan: no migration is required unless future persistence or schema changes are introduced.",
    sourceRefs: [`startup-ready:${run.id}:migration`],
    sources: [localStartupReadySource(run.id, now, "manual")],
    content: {
      owner: "founder",
      remediationTask:
        "Recheck migration impact before adding server persistence, schema changes, or shared data stores.",
      acceptanceCriteria:
        "Local launch remains safe when no schema migration is required, or a future migration plan is recorded before release.",
      state: "no_migration_required_for_local_launch",
      confidence: "local_manual"
    },
    gate: "launch",
    owner: "founder",
    remediationTask:
      "Recheck migration impact before adding server persistence, schema changes, or shared data stores.",
    acceptanceCriteria:
      "Local launch remains safe when no schema migration is required, or a future migration plan is recorded before release.",
    now,
    force:
      gateNeedsBaselineEvidence(gate.blockers, "migration plan evidence is missing") ||
      gateNeedsBaselineEvidence(gate.blockers, "migration plan", "needs owner")
  });
  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "rollback_plan",
    summary:
      "local_manual startup ready rollback plan: restore the previous git commit or previous static artifact if local launch regresses.",
    sourceRefs: [`startup-ready:${run.id}:rollback`],
    sources: [localStartupReadySource(run.id, now, "manual")],
    content: {
      owner: "founder",
      remediationTask:
        "Keep the latest passing git commit and generated static artifact restorable before public traffic.",
      acceptanceCriteria:
        "A failed local launch can be rolled back by reverting the commit or restoring the previous static output.",
      confidence: "local_manual"
    },
    gate: "launch",
    owner: "founder",
    remediationTask:
      "Keep the latest passing git commit and generated static artifact restorable before public traffic.",
    acceptanceCriteria:
      "A failed local launch can be rolled back by reverting the commit or restoring the previous static output.",
    now,
    force:
      gateNeedsBaselineEvidence(gate.blockers, "rollback plan evidence is missing") ||
      gateNeedsBaselineEvidence(gate.blockers, "rollback plan", "needs owner")
  });
  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "observability",
    summary:
      "local_manual startup ready observability baseline: local verifiers, UI smoke, reports, and diagnostics are the launch signals.",
    sourceRefs: [`startup-ready:${run.id}:observability`],
    sources: [localStartupReadySource(run.id, now, "local_command")],
    content: {
      owner: "founder",
      remediationTask:
        "Review verifier output, UI smoke artifacts, launch report, CI summary, and diagnostics after each launch change.",
      acceptanceCriteria:
        "Any failed verifier, smoke check, or launch gate produces an explicit blocker before release.",
      signals: [
        "command verifier evidence",
        "UI smoke DOM evidence",
        "launch readiness report",
        "startup complete product check",
        "ops diagnostics bundle"
      ],
      confidence: "local_manual"
    },
    gate: "launch",
    owner: "founder",
    remediationTask:
      "Review verifier output, UI smoke artifacts, launch report, CI summary, and diagnostics after each launch change.",
    acceptanceCriteria:
      "Any failed verifier, smoke check, or launch gate produces an explicit blocker before release.",
    now,
    force:
      gateNeedsBaselineEvidence(gate.blockers, "observability evidence is missing") ||
      gateNeedsBaselineEvidence(gate.blockers, "observability", "needs owner")
  });
  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "release_plan",
    summary:
      "local_manual startup ready release plan: run local verifiers, UI smoke, launch report, and complete-check before pushing.",
    sourceRefs: [`startup-ready:${run.id}:release-plan`],
    sources: [
      {
        kind: "deployment",
        uri: `deployment:local:${run.id}`,
        capturedAt: now.toISOString(),
        freshnessDays: 14,
        trustLevel: "low"
      }
    ],
    content: {
      owner: "founder",
      target: run.target,
      steps: [
        "run repository verifiers",
        "run local UI smoke",
        "generate launch readiness report",
        "run complete product check",
        "push only after local_launch_ready"
      ],
      deployment: "local development server",
      acceptanceCriteria:
        "Runstead reports local_launch_ready or explicit blockers before the repo is pushed.",
      confidence: "local_manual"
    },
    gate: "launch",
    owner: "founder",
    remediationTask:
      "Keep the release plan aligned with verifier, UI smoke, and CI commands.",
    acceptanceCriteria:
      "Runstead reports local_launch_ready or explicit blockers before the repo is pushed.",
    now
  });
  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "founder_bottleneck",
    summary:
      "local_manual startup ready founder bottleneck baseline: founder owns local launch decision and post-launch triage until handoff evidence exists.",
    sourceRefs: [`startup-ready:${run.id}:founder-bottleneck`],
    sources: [localStartupReadySource(run.id, now, "manual")],
    content: {
      owner: "founder",
      bottlenecks: [
        "local launch decision",
        "release checklist maintenance",
        "post-launch issue triage"
      ],
      systemOfRecord: "Runstead evidence ledger",
      status: "handoff-in-progress",
      confidence: "local_manual"
    },
    gate: "launch",
    owner: "founder",
    remediationTask:
      "Assign durable owners before moving from local launch readiness to scale readiness.",
    acceptanceCriteria:
      "Scale readiness remains blocked until workflow registry, delegation policy, and institutional memory evidence are recorded.",
    now,
    force: gateNeedsBaselineEvidence(
      gate.blockers,
      "founder bottleneck audit is missing"
    )
  });
}

export function gateNeedsBaselineEvidence(
  blockers: string[],
  ...needles: string[]
): boolean {
  const loweredNeedles = needles.map((needle) => needle.toLowerCase());

  return blockers.some((blocker) => {
    const lowered = blocker.toLowerCase();

    return loweredNeedles.every((needle) => lowered.includes(needle));
  });
}

export async function addLocalReadinessEvidenceIfMissing(
  evidenceTypes: Set<string>,
  input: {
    cwd: string;
    type: string;
    summary: string;
    sourceRefs: string[];
    sources: Parameters<typeof addStartupEvidence>[0]["sources"];
    content: Record<string, unknown>;
    gate: StartupGateStage;
    owner?: string;
    remediationTask?: string;
    acceptanceCriteria?: string;
    now: Date;
    force?: boolean;
  }
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

export function localStartupReadySource(
  runId: string,
  now: Date,
  kind: "manual" | "local_command"
): {
  kind: string;
  uri: string;
  capturedAt: string;
  freshnessDays: number;
  trustLevel: string;
} {
  return {
    kind,
    uri: `startup-ready:${runId}:${kind}`,
    capturedAt: now.toISOString(),
    freshnessDays: 14,
    trustLevel: "low"
  };
}
