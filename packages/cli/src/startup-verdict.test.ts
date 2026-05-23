import { describe, expect, it } from "vitest";

import { evaluateStartupVerdict, startupVerdictReady } from "./startup-verdict.js";

describe("startup verdict engine", () => {
  it("returns target-aware readiness from one shared evaluator", () => {
    const result = evaluateStartupVerdict({
      target: "local",
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
      evidenceTiers: ["local_command", "synthetic_smoke"],
      evidenceTypes: ["command_output", "startup_ui_validation"]
    });

    expect(result).toMatchObject({
      target: "local",
      verdict: "local_launch_ready",
      canLaunch: true,
      blockers: [],
      evidenceRefs: ["ev_test", "ev_ui"]
    });
    expect(result.targetReadiness.local).toMatchObject({
      verdict: "local_launch_ready",
      canLaunch: true
    });
    expect(result.targetReadiness.staging).toMatchObject({
      verdict: "staging_launch_blocked",
      canLaunch: false,
      blockers: [
        "CI-verified evidence is required for staging or production",
        "staging deployment evidence is required"
      ]
    });
  });

  it("uses the same ready verdict predicate for consumers", () => {
    expect(startupVerdictReady("local_launch_ready")).toBe(true);
    expect(startupVerdictReady("staging_launch_ready")).toBe(true);
    expect(startupVerdictReady("public_launch_ready")).toBe(true);
    expect(startupVerdictReady("local_launch_blocked")).toBe(false);
  });
});
