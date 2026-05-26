import {
  gateNeedsBaselineEvidence,
  localStartupReadySource
} from "./local-evidence-helpers.js";
import type { LocalReadinessEvidenceInput } from "./local-evidence-types.js";
import type { StartupReadinessRun } from "./types.js";

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
