import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import {
  formatLearningProposals,
  listLearningProposals
} from "./learning-proposals.js";
import { quarantineMemoryCandidate } from "./memory.js";

describe("learning proposals", () => {
  it("lists quarantined learning proposals with promotion metadata", async () => {
    const workspace = join(tmpdir(), `runstead-learning-proposals-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });

      const first = quarantineMemoryCandidate({
        cwd: workspace,
        scope: "repo:acme/app",
        type: "tooling_observation",
        content: "Local agent used pnpm verifiers successfully.",
        sourceRefs: ["task:task_001", "tool_call:tc_001", "evidence:ev_001"],
        confidence: 0.7,
        createdBy: "runstead:learning-review",
        taskId: "task_001",
        candidateKey: "learning:task_001:tooling_observation:abc123",
        proposal: {
          proposedScope: "repo:acme/app",
          requiredVerifier: "task_audit_review",
          suggestedPromotionAction: "promote-memory",
          sourceRunIds: ["wr_001"],
          toolCallIds: ["tc_001"]
        },
        now: new Date("2026-05-16T09:00:00.000Z")
      });
      quarantineMemoryCandidate({
        cwd: workspace,
        scope: "repo:acme/app",
        type: "skill_candidate",
        content: "Reusable repo inspection skill candidate.",
        sourceRefs: ["task:task_002"],
        candidateKey: "learning:task_002:skill_candidate:def456",
        proposal: {
          proposedScope: "repo:acme/app",
          requiredVerifier: "skill_test",
          suggestedPromotionAction: "create-skill",
          sourceRunIds: ["wr_002"]
        },
        now: new Date("2026-05-16T09:01:00.000Z")
      });

      const result = listLearningProposals({
        cwd: workspace,
        type: "tooling_observation"
      });
      const formatted = formatLearningProposals(result.proposals);

      expect(result.proposals).toEqual([
        expect.objectContaining({
          id: first.memory.id,
          candidateKey: "learning:task_001:tooling_observation:abc123",
          type: "tooling_observation",
          scope: "repo:acme/app",
          confidence: 0.7,
          sourceRefs: ["task:task_001", "tool_call:tc_001", "evidence:ev_001"],
          proposedScope: "repo:acme/app",
          requiredVerifier: "task_audit_review",
          suggestedPromotionAction: "promote-memory",
          sourceRunIds: ["wr_001"],
          toolCallIds: ["tc_001"],
          createdFromTask: "task_001"
        })
      ]);
      expect(formatted).toContain(`action: promote-memory`);
      expect(formatted).toContain("tool_calls: tc_001");
      expect(formatLearningProposals([])).toBe("No learning proposals found.");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
