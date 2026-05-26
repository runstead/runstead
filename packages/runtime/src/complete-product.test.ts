import { describe, expect, it } from "vitest";

import {
  defineRuntimeCompleteProductCriterion,
  runtimeCompleteProductArtifactCriterion,
  runtimeCompleteProductScore,
  runtimeCompleteProductStatus
} from "./complete-product.js";

describe("complete product runtime", () => {
  it("normalizes criterion status, evidence, and missing values", () => {
    expect(
      defineRuntimeCompleteProductCriterion({
        id: "review_surfaces",
        title: "Review Surfaces",
        passed: false,
        severity: "major",
        evidence: ["report.md", "report.md", ""],
        missing: ["dashboard.html", "dashboard.html", ""],
        nextAction: "build dashboard"
      })
    ).toEqual({
      id: "review_surfaces",
      title: "Review Surfaces",
      status: "blocked",
      severity: "major",
      evidence: ["report.md"],
      missing: ["dashboard.html"],
      nextAction: "build dashboard"
    });
  });

  it("scores complete-product criteria from passed criteria ratio", () => {
    const criteria = [
      defineRuntimeCompleteProductCriterion({
        id: "one",
        title: "One",
        passed: true,
        severity: "critical",
        evidence: [],
        missing: [],
        nextAction: "continue"
      }),
      defineRuntimeCompleteProductCriterion({
        id: "two",
        title: "Two",
        passed: false,
        severity: "major",
        evidence: [],
        missing: ["surface"],
        nextAction: "fix"
      })
    ];

    expect(runtimeCompleteProductStatus(criteria)).toBe("incomplete");
    expect(runtimeCompleteProductScore(criteria)).toBe(0.5);
    expect(runtimeCompleteProductStatus(criteria.slice(0, 1))).toBe("complete");
    expect(runtimeCompleteProductScore([])).toBe(0);
  });

  it("builds the artifact truth criterion from required review surfaces", () => {
    expect(
      runtimeCompleteProductArtifactCriterion({
        completeCheckMarkdown: "startup-complete-product-check.md",
        completeCheckJson: "startup-complete-product-check.json",
        evidenceId: "ev_complete",
        eventId: "evt_complete"
      })
    ).toMatchObject({
      id: "artifact_truth",
      status: "passed",
      severity: "critical"
    });
    expect(
      runtimeCompleteProductArtifactCriterion({
        completeCheckMarkdown: "",
        completeCheckJson: "startup-complete-product-check.json",
        evidenceId: "ev_complete",
        eventId: "evt_complete"
      }).status
    ).toBe("blocked");
  });
});
