import { describe, expect, it } from "vitest";

import {
  formatReadinessTargetBoundaryLines,
  nextReadinessAction,
  readinessTargetBoundary
} from "./readiness-guidance.js";

describe("readiness guidance runtime", () => {
  it("describes target boundaries without CLI coupling", () => {
    const local = readinessTargetBoundary("local");
    const production = readinessTargetBoundary("production");

    expect(local.requestedTarget).toBe("local");
    expect(local.boundary).toContain("not public launch clearance");
    expect(local.notEvidenceFor).toContain("public traffic");
    expect(production.requestedTarget).toBe("production");
    expect(production.boundary).toContain("production/public launch clearance");
  });

  it("formats target boundary lines for operator surfaces", () => {
    const lines = formatReadinessTargetBoundaryLines(
      readinessTargetBoundary("staging")
    );

    expect(lines).toContain("- Requested target: staging");
    expect(lines.some((line) => line.includes("private beta or staging rollout"))).toBe(
      true
    );
  });

  it("maps common blockers to next actions", () => {
    expect(nextReadinessAction([])).toBe("continue launch readiness");
    expect(nextReadinessAction(["CI-verified evidence is required"])).toBe(
      "run startup ready in CI and attach CI summary evidence"
    );
    expect(nextReadinessAction(["production deployment evidence is required"])).toBe(
      "attach deployment evidence for the requested target"
    );
    expect(nextReadinessAction(["unknown blocker"])).toBe("unknown blocker");
  });
});
