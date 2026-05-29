import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import {
  createSkillFromLearningCandidate,
  promoteLearningMemoryCandidate
} from "./learning-actions.js";
import { listLearningProposals } from "./learning-proposals.js";
import { quarantineMemoryCandidate } from "./memory.js";

describe("learning actions", () => {
  it("promotes quarantined learning memory after review", async () => {
    const workspace = join(tmpdir(), `runstead-learning-promote-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      const candidate = quarantineMemoryCandidate({
        cwd: workspace,
        scope: "repo:acme/app",
        type: "tooling_observation",
        content: "Use pnpm for local verifier commands.",
        sourceRefs: ["task:task_001"],
        candidateKey: "learning:task_001:tooling_observation:abc123",
        proposal: {
          suggestedPromotionAction: "promote-memory"
        }
      }).memory;

      const result = promoteLearningMemoryCandidate({
        cwd: workspace,
        candidateId: candidate.id,
        promotedBy: "reviewer",
        now: new Date("2026-05-16T10:00:00.000Z")
      });
      const database = openRunsteadDatabase(result.stateDb);

      try {
        const row = database
          .prepare(
            "SELECT status, confidence, provenance_json FROM memory_records WHERE id = ?"
          )
          .get(candidate.id) as {
          status: string;
          confidence: number;
          provenance_json: string;
        };
        const event = database
          .prepare("SELECT type FROM events WHERE event_id = ?")
          .get(result.event.eventId) as { type: string };

        expect(row.status).toBe("verified");
        expect(row.confidence).toBe(0.9);
        expect(JSON.parse(row.provenance_json)).toMatchObject({
          promotedBy: "reviewer"
        });
        expect(event.type).toBe("memory.candidate_promoted");
      } finally {
        database.close();
      }

      expect(listLearningProposals({ cwd: workspace }).proposals).toEqual([]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("creates a skill candidate package from a skill learning proposal", async () => {
    const workspace = join(tmpdir(), `runstead-learning-skill-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      const candidate = quarantineMemoryCandidate({
        cwd: workspace,
        scope: "repo:acme/app",
        type: "skill_candidate",
        content: "Reusable repo inspection skill candidate.",
        sourceRefs: ["task:task_002"],
        taskId: "task_002",
        candidateKey: "learning:task_002:skill_candidate:def456",
        proposal: {
          suggestedPromotionAction: "create-skill",
          suggestedSkill: {
            name: "repo-inspection-review",
            domain: "repo-maintenance",
            triggers: ["Inspect repository metadata"],
            allowedTools: ["workspace.read", "verifier.run"],
            deniedTools: ["secret.read"],
            verifierCommands: ["pnpm test"]
          }
        }
      }).memory;

      const result = await createSkillFromLearningCandidate({
        cwd: workspace,
        candidateId: candidate.id,
        now: new Date("2026-05-16T10:05:00.000Z")
      });
      const skillYaml = await readFile(join(result.skill.root, "skill.yaml"), "utf8");
      const database = openRunsteadDatabase(result.stateDb);

      try {
        const event = database
          .prepare("SELECT type, payload_json FROM events WHERE event_id = ?")
          .get(result.event.eventId) as {
          type: string;
          payload_json: string;
        };

        expect(event.type).toBe("learning.skill_candidate_created");
        expect(JSON.parse(event.payload_json)).toMatchObject({
          memoryId: candidate.id,
          skillName: "repo-inspection-review"
        });
      } finally {
        database.close();
      }

      expect(skillYaml).toContain("name: repo-inspection-review");
      expect(skillYaml).toContain("status: candidate");
      expect(result.skill.validation.valid).toBe(true);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
