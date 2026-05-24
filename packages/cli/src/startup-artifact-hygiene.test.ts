import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import {
  formatStartupArtifactHygiene,
  manageStartupArtifactHygiene
} from "./startup-artifact-hygiene.js";

describe("startup artifact hygiene", () => {
  it("writes latest views and prunes only old unreferenced artifacts", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-artifact-hygiene-"));
    const root = join(workspace, ".runstead");
    const stateDb = join(root, "state.db");

    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await mkdir(join(root, "reports"), { recursive: true });
      await mkdir(join(root, "startup", "readiness-runs"), { recursive: true });
      await writeFile(
        join(root, "config.yaml"),
        "version: 1\ndomain: ai-native-startup\n",
        "utf8"
      );

      const currentEvidence = join(root, "evidence", "metric-current.json");
      const oldEvidence = join(root, "evidence", "metric-old.json");
      const oldUnreferenced = join(root, "evidence", "old-unreferenced.log");
      const report = join(root, "reports", "launch-readiness-ai-native-startup.md");
      const latestRunPath = join(
        root,
        "startup",
        "readiness-runs",
        "run_latest.json"
      );

      await writeFile(currentEvidence, "{}\n", "utf8");
      await writeFile(oldEvidence, "{}\n", "utf8");
      await writeFile(oldUnreferenced, "old\n", "utf8");
      await writeFile(report, "# Launch\n", "utf8");
      await writeFile(
        latestRunPath,
        `${JSON.stringify(
          {
            id: "run_latest",
            startedAt: "2026-05-20T00:00:00.000Z",
            completedAt: "2026-05-20T00:10:00.000Z",
            reportPaths: [report],
            phases: [
              {
                id: "launch_report",
                artifacts: [currentEvidence, report]
              }
            ]
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const oldDate = new Date("2026-04-01T00:00:00.000Z");

      await utimes(oldEvidence, oldDate, oldDate);
      await utimes(oldUnreferenced, oldDate, oldDate);

      const database = openRunsteadDatabase(stateDb);

      try {
        appendEventAndProject(database, {
          event: {
            eventId: "evt_hygiene_old",
            type: "evidence.recorded",
            aggregateType: "evidence",
            aggregateId: "ev_metric_old",
            payload: {},
            createdAt: "2026-04-01T00:00:00.000Z"
          },
          projection: {
            type: "evidence",
            value: {
              id: "ev_metric_old",
              type: "startup_metric_snapshot",
              subjectType: "goal",
              subjectId: "goal_hygiene",
              uri: pathToFileURL(oldEvidence).href,
              summary: "old metric",
              createdAt: "2026-04-01T00:00:00.000Z"
            }
          }
        });
        appendEventAndProject(database, {
          event: {
            eventId: "evt_hygiene_current",
            type: "evidence.recorded",
            aggregateType: "evidence",
            aggregateId: "ev_metric_current",
            payload: {},
            createdAt: "2026-05-20T00:05:00.000Z"
          },
          projection: {
            type: "evidence",
            value: {
              id: "ev_metric_current",
              type: "startup_metric_snapshot",
              subjectType: "goal",
              subjectId: "goal_hygiene",
              uri: pathToFileURL(currentEvidence).href,
              summary: "current metric",
              createdAt: "2026-05-20T00:05:00.000Z"
            }
          }
        });
      } finally {
        database.close();
      }

      const result = await manageStartupArtifactHygiene({
        cwd: workspace,
        retentionDays: 7,
        now: new Date("2026-05-24T00:00:00.000Z")
      });

      expect(result.latest).toMatchObject({
        readinessRun: "run_latest",
        evidenceByType: {
          startup_metric_snapshot: "ev_metric_current"
        }
      });
      expect(result.files.find((file) => file.path === currentEvidence)?.layer).toBe(
        "current"
      );
      expect(result.files.find((file) => file.path === oldEvidence)?.layer).toBe(
        "superseded"
      );
      expect(result.pruneCandidates.map((file) => file.path)).toContain(
        oldUnreferenced
      );
      await expect(readFile(result.latestPath, "utf8")).resolves.toContain(
        "ev_metric_current"
      );
      await expect(readFile(result.reportPath, "utf8")).resolves.toContain(
        "Startup Artifact Hygiene"
      );
      expect(formatStartupArtifactHygiene(result)).toContain("Prune candidates: 1");

      const pruned = await manageStartupArtifactHygiene({
        cwd: workspace,
        retentionDays: 7,
        prune: true,
        now: new Date("2026-05-24T00:01:00.000Z")
      });

      expect(pruned.deletedFiles).toEqual([oldUnreferenced]);
      await expect(access(oldUnreferenced)).rejects.toThrow();
      await expect(access(oldEvidence)).resolves.toBeUndefined();
      await expect(access(currentEvidence)).resolves.toBeUndefined();
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
