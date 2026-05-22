import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it, vi } from "vitest";

import { createProgram } from "./index.js";
import { initRunstead } from "./init.js";
import { addStartupEvidence, checkStartupGate } from "./startup-evidence.js";
import {
  assessStartupMetrics,
  recordStartupMetricSnapshot
} from "./startup-metrics.js";
import { installDomainPack } from "./domain-pack-install.js";
import { createGoal } from "./goals.js";

describe("startup metric snapshots", () => {
  it("records structured metric snapshots and false-positive evidence", async () => {
    const workspace = join(tmpdir(), `runstead-startup-metric-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });

      const recorded = await recordStartupMetricSnapshot({
        cwd: workspace,
        metric: "activation",
        source: "PostHog activation funnel",
        threshold: "0.40",
        current: "0.53",
        sourceRefs: ["posthog:funnel:activation:2026-05-14"],
        unit: "ratio",
        window: "7d",
        cohort: "new_signups",
        trend: "up",
        snapshotDate: "2026-05-14",
        falsePositive: "Exclude internal founder smoke-test events",
        now: new Date("2026-05-14T05:00:00.000Z")
      });
      const artifact = JSON.parse(
        await readFile(recorded.metricEvidence.artifactPath, "utf8")
      ) as {
        evidenceType: string;
        content: string;
        sources: { kind: string; uri: string; capturedAt: string }[];
      };
      const content = JSON.parse(artifact.content) as Record<string, unknown>;

      expect(artifact.evidenceType).toBe("metric_snapshot");
      expect(artifact.sources).toMatchObject([
        {
          kind: "posthog",
          uri: "posthog:funnel:activation:2026-05-14",
          capturedAt: "2026-05-14T05:00:00.000Z"
        }
      ]);
      expect(content).toMatchObject({
        metric: "activation",
        source: "PostHog activation funnel",
        threshold: 0.4,
        current: 0.53,
        sourceClass: "analytics_real_user",
        confidence: 0.9,
        launchWeight: 1,
        realUserData: true,
        snapshotDate: "2026-05-14",
        falsePositive: "Exclude internal founder smoke-test events",
        cohort: "new_signups",
        trend: "up"
      });
      expect(recorded.falsePositiveEvidence?.evidence.type).toBe(
        "startup_false_positive"
      );

      await addStartupEvidence({
        cwd: workspace,
        type: "measurement_framework",
        summary: "Measurement framework is defined",
        now: new Date("2026-05-14T05:05:00.000Z")
      });
      const launchGate = await checkStartupGate({
        cwd: workspace,
        stage: "launch",
        now: new Date("2026-05-14T05:10:00.000Z")
      });

      expect(launchGate.blockers).not.toContain("measurement framework is missing");
      expect(launchGate.blockers).not.toContain(
        "metric snapshot with source, threshold, and current value is missing"
      );

      const cliOutput = await runCli(
        "startup",
        "measurement",
        "snapshot",
        "--cwd",
        workspace,
        "--metric",
        "d7_retention",
        "--source",
        "local smoke flow",
        "--source-class",
        "synthetic_smoke",
        "--confidence",
        "0.4",
        "--source-uri",
        "file:cohorts/d7-smoke.json",
        "--source-kind",
        "browser_ui",
        "--captured-at",
        "2026-05-14T04:00:00.000Z",
        "--freshness-days",
        "7",
        "--source-hash",
        "sha256:d7",
        "--threshold",
        "0.20",
        "--current",
        "0.24",
        "--date",
        "2026-05-14"
      );

      expect(cliOutput).toContain("Recorded metric snapshot evidence:");
      expect(cliOutput).toContain(
        "Metric source class: synthetic_smoke confidence=0.4 launch_weight=0.25"
      );
      expect(evidenceTypes(workspace)).toEqual(
        expect.arrayContaining([
          "startup_false_positive",
          "startup_measurement_framework",
          "startup_metric_snapshot"
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("assesses missing, stale, and below-threshold metrics and creates instrumentation tasks", async () => {
    const workspace = join(tmpdir(), `runstead-startup-metric-assess-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await installDomainPack({
        cwd: workspace,
        ref: "ai-native-startup",
        now: new Date("2026-05-14T01:00:00.000Z")
      });
      await createGoal({
        cwd: workspace,
        domain: "ai-native-startup",
        template: "build-mvp",
        now: new Date("2026-05-14T01:05:00.000Z")
      });
      await recordStartupMetricSnapshot({
        cwd: workspace,
        metric: "activation",
        source: "PostHog",
        threshold: "0.50",
        current: "0.42",
        sources: [
          {
            uri: "posthog:activation",
            kind: "posthog",
            capturedAt: "2026-05-01T00:00:00.000Z",
            freshnessDays: 7
          }
        ],
        window: "7d",
        cohort: "new_signups",
        trend: "down",
        now: new Date("2026-05-14T01:10:00.000Z")
      });

      const assessed = await assessStartupMetrics({
        cwd: workspace,
        requiredMetrics: ["activation", "retention"],
        createTasks: true,
        now: new Date("2026-05-14T01:15:00.000Z")
      });

      expect(assessed.metrics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            metric: "activation",
            status: "stale",
            sourceClass: "analytics_real_user",
            confidence: 0.9,
            launchWeight: 1,
            realUserData: true,
            cohort: "new_signups",
            trend: "down"
          }),
          expect.objectContaining({
            metric: "retention",
            status: "missing"
          })
        ])
      );
      expect(assessed.staleMetrics).toEqual(["activation"]);
      expect(assessed.missingMetrics).toEqual(["retention"]);
      expect(assessed.instrumentationTasks).toHaveLength(1);
      expect(assessed.instrumentationTasks[0]).toMatchObject({
        type: "instrument_metric",
        input: {
          metric: "retention"
        }
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

async function runCli(...args: string[]): Promise<string> {
  const output: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...items: unknown[]) => {
    output.push(items.map(String).join(" "));
  });

  try {
    await createProgram({ entrypoint: "/usr/local/bin/runstead" }).parseAsync(args, {
      from: "user"
    });
  } finally {
    log.mockRestore();
  }

  return output.join("\n");
}

function evidenceTypes(workspace: string): string[] {
  const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

  try {
    return (
      database
        .prepare(
          `
          SELECT DISTINCT type
          FROM evidence
          ORDER BY type ASC
        `
        )
        .all() as { type: string }[]
    ).map((row) => row.type);
  } finally {
    database.close();
  }
}
