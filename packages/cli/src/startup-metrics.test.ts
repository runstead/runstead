import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it, vi } from "vitest";

import { createProgram } from "./index.js";
import { initRunstead } from "./init.js";
import { addStartupEvidence, checkStartupGate } from "./startup-evidence.js";
import { recordStartupMetricSnapshot } from "./startup-metrics.js";

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
        snapshotDate: "2026-05-14",
        falsePositive: "Exclude internal founder smoke-test events"
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
        "manual cohort CSV",
        "--source-uri",
        "file:cohorts/d7.csv",
        "--source-kind",
        "csv",
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
