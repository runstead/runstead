import type { StartupGateStage, addStartupEvidence } from "../startup-evidence.js";
import type { StartupReadinessRun } from "./types.js";

export interface LocalReadinessEvidenceInput {
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

export function startupReadyLocalMvpEvidenceInputs(
  run: StartupReadinessRun,
  now: Date,
  blockers: string[]
): LocalReadinessEvidenceInput[] {
  return [
    {
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
      force: gateNeedsBaselineEvidence(blockers, "problem hypothesis is missing")
    },
    {
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
      force: gateNeedsBaselineEvidence(blockers, "user hypothesis is missing")
    },
    {
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
      force: gateNeedsBaselineEvidence(blockers, "solution hypothesis is missing")
    },
    {
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
      force: gateNeedsBaselineEvidence(blockers, "disconfirming evidence is missing")
    }
  ];
}

export function startupReadyLocalLaunchEvidenceInputs(
  run: StartupReadinessRun,
  now: Date,
  blockers: string[]
): LocalReadinessEvidenceInput[] {
  return [
    {
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
        uiSmokePhase: phaseStatusForEvidence(run, "ui_smoke")
      },
      gate: "launch",
      now,
      force: gateNeedsBaselineEvidence(
        blockers,
        "metric snapshot with source, threshold, and current value is missing"
      )
    },
    {
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
        gateNeedsBaselineEvidence(blockers, "migration plan evidence is missing") ||
        gateNeedsBaselineEvidence(blockers, "migration plan", "needs owner")
    },
    {
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
        gateNeedsBaselineEvidence(blockers, "rollback plan evidence is missing") ||
        gateNeedsBaselineEvidence(blockers, "rollback plan", "needs owner")
    },
    {
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
        gateNeedsBaselineEvidence(blockers, "observability evidence is missing") ||
        gateNeedsBaselineEvidence(blockers, "observability", "needs owner")
    },
    {
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
    },
    {
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
      force: gateNeedsBaselineEvidence(blockers, "founder bottleneck audit is missing")
    }
  ];
}

function gateNeedsBaselineEvidence(blockers: string[], ...needles: string[]): boolean {
  const loweredNeedles = needles.map((needle) => needle.toLowerCase());

  return blockers.some((blocker) => {
    const lowered = blocker.toLowerCase();

    return loweredNeedles.every((needle) => lowered.includes(needle));
  });
}

function localStartupReadySource(
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

function phaseStatusForEvidence(run: StartupReadinessRun, phaseId: string): string {
  return run.phases.find((phase) => phase.id === phaseId)?.status ?? "not_included";
}
