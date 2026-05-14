import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import {
  listProjectFacts,
  quarantineMemoryCandidate,
  recordProjectFact,
  retrieveProjectFacts
} from "./memory.js";

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

describe("recordProjectFact", () => {
  it("stores verified project facts from readable repo files", async () => {
    const workspace = join(tmpdir(), `runstead-project-fact-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      const initialized = await initRunstead({ cwd: workspace });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ packageManager: "pnpm@11.1.1" })}\n`,
        "utf8"
      );

      const result = recordProjectFact({
        cwd: workspace,
        scope: "repo:acme/app",
        content: "This repo uses pnpm.",
        sourceRefs: ["file:package.json"],
        createdBy: "worker:repo_inspector",
        now: new Date("2026-05-14T06:00:00.000Z")
      });
      const facts = listProjectFacts({
        cwd: workspace,
        scope: "repo:acme/app"
      }).facts;
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
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

        expect(result.memory).toMatchObject({
          type: "project_fact",
          status: "verified",
          confidence: 0.95,
          content: "This repo uses pnpm.",
          sourceRefs: ["file:package.json"]
        });
        expect(facts).toEqual([result.memory]);
        expect(event).toEqual({
          type: "memory.project_fact_verified",
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

  it("rejects project facts from non-file sources", async () => {
    const workspace = join(tmpdir(), `runstead-project-fact-invalid-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });

      expect(() =>
        recordProjectFact({
          cwd: workspace,
          scope: "repo:acme/app",
          content: "This repo uses pnpm.",
          sourceRefs: ["github:issue/123"]
        })
      ).toThrow("file:");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects duplicate verified project facts in the same scope", async () => {
    const workspace = join(tmpdir(), `runstead-project-fact-duplicate-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ packageManager: "pnpm@11.1.1" })}\n`,
        "utf8"
      );

      const fact = recordProjectFact({
        cwd: workspace,
        scope: "repo:acme/app",
        content: "This repo uses pnpm.",
        sourceRefs: ["file:package.json"]
      }).memory;

      expect(() =>
        recordProjectFact({
          cwd: workspace,
          scope: "repo:acme/app",
          content: "  this repo uses pnpm.  ",
          sourceRefs: ["file:package.json"]
        })
      ).toThrow(`Duplicate project fact conflicts with ${fact.id}`);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("records explicit same-scope project fact conflicts", async () => {
    const workspace = join(tmpdir(), `runstead-project-fact-conflict-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ packageManager: "pnpm@11.1.1" })}\n`,
        "utf8"
      );
      await writeFile(
        join(workspace, "README.md"),
        "Historical docs mention npm.\n",
        "utf8"
      );

      const currentFact = recordProjectFact({
        cwd: workspace,
        scope: "repo:acme/app",
        content: "This repo uses pnpm.",
        sourceRefs: ["file:package.json"],
        now: new Date("2026-05-14T06:00:00.000Z")
      }).memory;
      const historicalFact = recordProjectFact({
        cwd: workspace,
        scope: "repo:acme/app",
        content: "Historical docs mention npm.",
        sourceRefs: ["file:README.md"],
        conflictsWith: [currentFact.id],
        now: new Date("2026-05-14T06:01:00.000Z")
      }).memory;

      expect(historicalFact.conflictsWith).toEqual([currentFact.id]);
      expect(
        listProjectFacts({ cwd: workspace, scope: "repo:acme/app" }).facts.map(
          (fact) => [fact.id, fact.conflictsWith]
        )
      ).toEqual([
        [historicalFact.id, [currentFact.id]],
        [currentFact.id, []]
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

describe("retrieveProjectFacts", () => {
  it("audits project fact retrievals with result ids", async () => {
    const workspace = join(tmpdir(), `runstead-memory-retrieval-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      const initialized = await initRunstead({ cwd: workspace });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ packageManager: "pnpm@11.1.1" })}\n`,
        "utf8"
      );
      await writeFile(
        join(workspace, "tsconfig.json"),
        `${JSON.stringify({ compilerOptions: { strict: true } })}\n`,
        "utf8"
      );

      const pnpmFact = recordProjectFact({
        cwd: workspace,
        scope: "repo:acme/app",
        content: "This repo uses pnpm.",
        sourceRefs: ["file:package.json"],
        now: new Date("2026-05-14T06:00:00.000Z")
      }).memory;
      recordProjectFact({
        cwd: workspace,
        scope: "repo:acme/app",
        content: "This repo uses TypeScript strict mode.",
        sourceRefs: ["file:tsconfig.json"],
        now: new Date("2026-05-14T06:01:00.000Z")
      });

      const result = retrieveProjectFacts({
        cwd: workspace,
        scope: "repo:acme/app",
        query: "pnpm",
        limit: 1,
        now: new Date("2026-05-14T06:02:00.000Z")
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const event = database
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id, payload_json
            FROM events
            WHERE event_id = ?
          `
          )
          .get(result.event.eventId) as {
          type: string;
          aggregate_type: string;
          aggregate_id: string;
          payload_json: string;
        };

        expect(result.facts).toEqual([pnpmFact]);
        expect(event).toMatchObject({
          type: "memory.retrieval_audited",
          aggregate_type: "memory_retrieval",
          aggregate_id: result.retrievalId
        });
        expect(JSON.parse(event.payload_json)).toMatchObject({
          retrievalId: result.retrievalId,
          scope: "repo:acme/app",
          query: "pnpm",
          limit: 1,
          resultCount: 1,
          resultIds: [pnpmFact.id]
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("excludes explicitly conflicted project facts unless requested", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-memory-conflict-retrieval-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ packageManager: "pnpm@11.1.1" })}\n`,
        "utf8"
      );
      await writeFile(
        join(workspace, "README.md"),
        "Historical docs mention npm.\n",
        "utf8"
      );

      const currentFact = recordProjectFact({
        cwd: workspace,
        scope: "repo:acme/app",
        content: "This repo uses pnpm.",
        sourceRefs: ["file:package.json"],
        now: new Date("2026-05-14T06:00:00.000Z")
      }).memory;
      const historicalFact = recordProjectFact({
        cwd: workspace,
        scope: "repo:acme/app",
        content: "Historical docs mention npm.",
        sourceRefs: ["file:README.md"],
        conflictsWith: [currentFact.id],
        now: new Date("2026-05-14T06:01:00.000Z")
      }).memory;

      const defaultRetrieval = retrieveProjectFacts({
        cwd: workspace,
        scope: "repo:acme/app"
      });
      const diagnosticRetrieval = retrieveProjectFacts({
        cwd: workspace,
        scope: "repo:acme/app",
        includeConflicted: true
      });

      expect(defaultRetrieval.facts).toEqual([]);
      expect(diagnosticRetrieval.facts.map((fact) => fact.id)).toEqual([
        historicalFact.id,
        currentFact.id
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
