import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import { quarantineMemoryCandidate } from "./memory.js";

describe("quarantineMemoryCandidate", () => {
  it("stores unverified memory candidates in quarantine", async () => {
    const workspace = join(tmpdir(), `runstead-memory-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      const initialized = await initRunstead({ cwd: workspace });
      const result = quarantineMemoryCandidate({
        cwd: workspace,
        scope: "repo:acme/app",
        type: "external_claim",
        content: "A GitHub issue says the project uses npm.",
        sourceRefs: ["github:issue/123"],
        confidence: 0.35,
        createdBy: "worker:triage",
        taskId: "task_triage_001",
        now: new Date("2026-05-14T05:30:00.000Z")
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const memory = database
          .prepare(
            `
            SELECT id, scope, type, status, confidence, content,
                   source_refs_json, provenance_json
            FROM memory_records
            WHERE id = ?
          `
          )
          .get(result.memory.id) as {
          id: string;
          scope: string;
          type: string;
          status: string;
          confidence: number;
          content: string;
          source_refs_json: string;
          provenance_json: string;
        };
        const event = database
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id
            FROM events
            WHERE event_id = ?
          `
          )
          .get(result.event.eventId) as {
          type: string;
          aggregate_type: string;
          aggregate_id: string;
        };

        expect(memory).toMatchObject({
          id: result.memory.id,
          scope: "repo:acme/app",
          type: "external_claim",
          status: "quarantined",
          confidence: 0.35,
          content: "A GitHub issue says the project uses npm.",
          source_refs_json: JSON.stringify(["github:issue/123"])
        });
        expect(JSON.parse(memory.provenance_json)).toEqual({
          createdBy: "worker:triage",
          createdFromTask: "task_triage_001"
        });
        expect(event).toEqual({
          type: "memory.candidate_quarantined",
          aggregate_type: "memory",
          aggregate_id: result.memory.id
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects invalid confidence values before persistence", async () => {
    const workspace = join(tmpdir(), `runstead-memory-invalid-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });

      expect(() =>
        quarantineMemoryCandidate({
          cwd: workspace,
          scope: "repo:acme/app",
          type: "external_claim",
          content: "Unverified claim",
          confidence: 2
        })
      ).toThrow();
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
