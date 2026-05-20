import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Evidence, Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { installDomainPack } from "./domain-pack-install.js";
import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { generateLaunchReadinessReport } from "./launch-readiness-report.js";

describe("generateLaunchReadinessReport", () => {
  it("writes a launch readiness report and records an audit event", async () => {
    const workspace = join(tmpdir(), `runstead-launch-report-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "launch-report-fixture",
            private: true,
            packageManager: "pnpm@11.1.1",
            scripts: {
              test: "vitest run",
              lint: "eslint ."
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const initialized = await initRunstead({ cwd: workspace });
      await installDomainPack({
        cwd: workspace,
        ref: "ai-native-startup",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      const created = await createGoal({
        cwd: workspace,
        domain: "ai-native-startup",
        template: "build-mvp",
        now: new Date("2026-05-14T03:00:00.000Z")
      });
      const verifierTask = created.generatedTasks.find(
        (task) => task.type === "run_mvp_verifiers"
      );
      const measurementTask = created.generatedTasks.find(
        (task) => task.type === "define_measurement_framework"
      );

      if (verifierTask === undefined || measurementTask === undefined) {
        throw new Error("Expected startup goal to generate verifier and metrics tasks");
      }

      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        projectTask(database, {
          ...verifierTask,
          status: "completed",
          updatedAt: "2026-05-14T03:20:00.000Z"
        });
        projectTask(database, {
          ...measurementTask,
          status: "completed",
          updatedAt: "2026-05-14T03:25:00.000Z"
        });
        projectEvidence(database, {
          id: "ev_launch_report_command_001",
          type: "command_output",
          subjectType: "task",
          subjectId: verifierTask.id,
          uri: "file:///repo/.runstead/evidence/verifier.json",
          summary: "test: passed; lint: passed",
          createdAt: "2026-05-14T03:21:00.000Z"
        });
        projectEvidence(database, {
          id: "ev_launch_report_metrics_001",
          type: "startup_measurement_framework",
          subjectType: "task",
          subjectId: measurementTask.id,
          uri: "file:///repo/.runstead/evidence/metrics.json",
          summary: "activation and retention metrics defined",
          createdAt: "2026-05-14T03:26:00.000Z"
        });
      } finally {
        database.close();
      }

      const result = await generateLaunchReadinessReport({
        cwd: workspace,
        domain: "ai-native-startup",
        now: new Date("2026-05-14T12:00:00.000Z")
      });
      const markdown = await readFile(result.reportPath, "utf8");

      expect(result.status).toBe("blocked");
      expect(result.blockers).toContain("CI configuration is missing");
      expect(markdown).toBe(result.markdown);
      expect(markdown).toContain("# Runstead Launch Readiness Report");
      expect(markdown).toContain("## Repo Health");
      expect(markdown).toContain("## Verifier Status");
      expect(markdown).toContain("## Release Blockers");
      expect(markdown).toContain("ev_launch_report_command_001");
      expect(markdown).toContain("measurement framework");

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
          aggregate_id: "launch_readiness_ai_native_startup"
        });
        expect(JSON.parse(event?.payload_json ?? "{}")).toMatchObject({
          reportType: "launch_readiness",
          domain: "ai-native-startup",
          status: "blocked",
          summary: {
            blockers: result.blockers.length,
            tasks: 4
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

function projectTask(
  database: ReturnType<typeof openRunsteadDatabase>,
  task: Task
): void {
  appendEventAndProject(database, {
    event: {
      eventId: `evt_${task.id}`,
      type: "task.updated",
      aggregateType: "task",
      aggregateId: task.id,
      payload: {
        status: task.status
      },
      createdAt: task.updatedAt
    },
    projection: {
      type: "task",
      value: task
    }
  });
}

function projectEvidence(
  database: ReturnType<typeof openRunsteadDatabase>,
  evidence: Evidence
): void {
  appendEventAndProject(database, {
    event: {
      eventId: `evt_${evidence.id}`,
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
}
