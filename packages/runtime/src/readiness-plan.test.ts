import { describe, expect, it } from "vitest";

import {
  compileReadinessPlan,
  compileReadinessReleaseDecision,
  evaluateCompiledReadinessPlan,
  readinessVerdictReady
} from "./readiness-plan.js";

describe("readiness plan runtime", () => {
  it("compiles readiness inputs into stable facets and one target-aware verdict", () => {
    const plan = compileReadinessPlan({
      target: "local",
      stage: "launch",
      phases: [
        {
          id: "verifiers",
          title: "Run verifiers",
          status: "passed",
          evidenceIds: ["ev_test"]
        },
        {
          id: "ui_smoke",
          title: "UI smoke",
          status: "passed",
          evidenceIds: ["ev_ui"]
        }
      ],
      evidenceTiers: ["local_command", "synthetic_smoke", "local_command"],
      evidenceTypes: ["command_output", "startup_ui_validation"],
      staleEvidenceRefs: ["ev_old"]
    });

    expect(plan).toMatchObject({
      schemaVersion: 1,
      target: "local",
      stage: "launch",
      evidenceTiers: ["local_command", "synthetic_smoke"],
      evidenceTypes: ["command_output", "startup_ui_validation"],
      staleEvidenceRefs: ["ev_old"]
    });
    expect(plan.facets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "phase", key: "verifiers" }),
        expect.objectContaining({ kind: "phase", key: "ui_smoke" }),
        expect.objectContaining({ kind: "evidence_tier", key: "local_command" }),
        expect.objectContaining({ kind: "freshness", key: "ev_old" })
      ])
    );

    const result = evaluateCompiledReadinessPlan(plan);

    expect(result).toMatchObject({
      target: "local",
      verdict: "local_launch_ready",
      canLaunch: true,
      blockers: [],
      warnings: ["stale evidence is excluded from readiness verdict: ev_old"],
      evidenceRefs: ["ev_test", "ev_ui"]
    });
    expect(result.targetReadiness.staging).toMatchObject({
      verdict: "staging_launch_blocked",
      blockers: [
        "CI-verified evidence is required for staging or production",
        "staging deployment evidence is required",
        "rollback drill evidence is required for staging",
        "monitoring alert evidence is required for staging",
        "migration validation evidence is required for staging"
      ]
    });
  });

  it("keeps verdict readiness predicates target agnostic", () => {
    expect(readinessVerdictReady("local_launch_ready")).toBe(true);
    expect(readinessVerdictReady("staging_launch_ready")).toBe(true);
    expect(readinessVerdictReady("public_launch_ready")).toBe(true);
    expect(readinessVerdictReady("public_launch_blocked")).toBe(false);
  });

  it("compiles release decisions from gate, readiness, and external checks", () => {
    const decision = compileReadinessReleaseDecision({
      gate: {
        passed: false,
        blockers: ["Launch gate lacks local evidence"],
        warnings: ["Synthetic evidence is low confidence"]
      },
      readiness: {
        verdict: "local_launch_ready",
        blockers: []
      },
      externalChecks: [
        {
          id: "github_actions",
          status: "failed",
          blocker: "remote GitHub Actions failed for HEAD"
        },
        {
          id: "deployment",
          status: "unknown",
          warning: "deployment evidence is unknown"
        }
      ]
    });

    expect(decision).toMatchObject({
      status: "block_release",
      passed: false,
      readinessVerdict: "local_launch_ready",
      blockers: ["remote GitHub Actions failed for HEAD"],
      warnings: [
        "Synthetic evidence is low confidence",
        "startup readiness verdict local_launch_ready superseded gate blocker: Launch gate lacks local evidence",
        "deployment evidence is unknown"
      ],
      supersededGateBlockers: ["Launch gate lacks local evidence"]
    });
  });
});
