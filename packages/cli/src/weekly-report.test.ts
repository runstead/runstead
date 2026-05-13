import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Evidence } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { generateWeeklyReport, isoWeekLabel } from "./weekly-report.js";

describe("isoWeekLabel", () => {
  it("uses ISO week numbering", () => {
    expect(isoWeekLabel(new Date("2026-05-14T12:00:00.000Z"))).toBe("2026-W20");
    expect(isoWeekLabel(new Date("2027-01-01T12:00:00.000Z"))).toBe("2026-W53");
  });
});

describe("generateWeeklyReport", () => {
  it("writes a weekly report and records an audit event", async () => {
    const workspace = join(tmpdir(), `runstead-report-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });

      const initialized = await initRunstead({ cwd: workspace });
      const created = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T03:00:00.000Z")
      });
      const task = created.generatedTasks[0];

      if (task === undefined) {
        throw new Error("Expected createGoal to generate a task");
      }

      const evidence: Evidence = {
        id: "ev_weekly_report_001",
        type: "command_output",
        subjectType: "task",
        subjectId: task.id,
        uri: "file:///repo/.runstead/evidence/test.json",
        summary: "test: passed",
        createdAt: "2026-05-14T03:10:00.000Z"
      };
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        appendEventAndProject(database, {
          event: {
            eventId: "evt_weekly_report_evidence_001",
            type: "evidence.recorded",
            aggregateType: "evidence",
            aggregateId: evidence.id,
            payload: {
              evidenceId: evidence.id
            },
            createdAt: evidence.createdAt
          },
          projection: {
            type: "evidence",
            value: evidence
          }
        });
      } finally {
        database.close();
      }

      const result = await generateWeeklyReport({
        cwd: workspace,
        week: "2026-W20",
        now: new Date("2026-05-14T12:00:00.000Z")
      });
      const markdown = await readFile(result.reportPath, "utf8");

      expect(result.week).toBe("2026-W20");
      expect(result.periodStart).toBe("2026-05-11T00:00:00.000Z");
      expect(result.periodEnd).toBe("2026-05-18T00:00:00.000Z");
      expect(markdown).toBe(result.markdown);
      expect(markdown).toContain("# Runstead Weekly Report");
      expect(markdown).toContain("- Active goals: 1");
      expect(markdown).toContain("- Tasks touched: 1");
      expect(markdown).toContain("run_local_verifiers");
      expect(markdown).toContain("ev_weekly_report_001 command_output");
      expect(markdown).toContain("evidence.recorded evidence/ev_weekly_report_001");

      const auditDatabase = openRunsteadDatabase(initialized.stateDb);

      try {
        const event = auditDatabase
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id, payload_json
            FROM events
            WHERE event_id = ?
          `
          )
          .get(result.event.eventId) as
          | {
              type: string;
              aggregate_type: string;
              aggregate_id: string;
              payload_json: string;
            }
          | undefined;

        expect(event).toMatchObject({
          type: "report.generated",
          aggregate_type: "report",
          aggregate_id: "weekly_2026_W20"
        });
        expect(JSON.parse(event?.payload_json ?? "{}")).toMatchObject({
          reportType: "weekly",
          week: "2026-W20",
          summary: {
            activeGoals: 1,
            tasksTouched: 1
          }
        });
      } finally {
        auditDatabase.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
