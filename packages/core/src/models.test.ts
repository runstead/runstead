import { describe, expect, it } from "vitest";

import { GoalSchema } from "./models.js";

describe("GoalSchema", () => {
  it("accepts the minimal active goal shape", () => {
    const goal = GoalSchema.parse({
      id: "goal_001",
      domain: "repo-maintenance",
      title: "Keep CI green",
      status: "active",
      priority: "medium",
      scope: { repositories: ["github.com/acme/app"] },
      createdAt: "2026-05-13T10:00:00+08:00",
      updatedAt: "2026-05-13T10:00:00+08:00"
    });

    expect(goal.domain).toBe("repo-maintenance");
  });
});
