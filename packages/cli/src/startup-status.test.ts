import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { addStartupEvidence } from "./startup-evidence.js";
import { startupOnboard } from "./startup-founder-flow.js";
import { formatStartupStatus, getStartupStatus } from "./startup-status.js";

describe("startup status", () => {
  it("summarizes founder gates, evidence freshness, blockers, and next action", async () => {
    const workspace = join(tmpdir(), `runstead-startup-status-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "startup-status-fixture",
            private: true,
            scripts: {
              test: "node -e \"console.log('test ok')\""
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      await startupOnboard({
        cwd: workspace,
        now: new Date("2026-05-14T00:00:00.000Z")
      });
      await addStartupEvidence({
        cwd: workspace,
        type: "metric_snapshot",
        summary: "Activation snapshot is stale",
        sources: [
          {
            uri: "posthog:activation",
            kind: "posthog",
            capturedAt: "2026-04-01T00:00:00.000Z",
            freshnessDays: 7
          }
        ],
        content: JSON.stringify({
          source: "posthog",
          threshold: "0.4",
          current: "0.5"
        }),
        now: new Date("2026-05-14T00:05:00.000Z")
      });

      const status = await getStartupStatus({
        cwd: workspace,
        now: new Date("2026-05-14T00:10:00.000Z")
      });

      expect(status.currentStage).toBe("mvp");
      expect(status.gates).toHaveLength(3);
      expect(status.gates.find((gate) => gate.stage === "launch")).toMatchObject({
        status: "blocked"
      });
      expect(status.evidence.total).toBeGreaterThan(0);
      expect(status.evidence.sourceKinds).toContain("posthog");
      expect(status.evidence.staleSources).toEqual([
        expect.objectContaining({
          uri: "posthog:activation",
          freshnessDays: 7
        })
      ]);
      expect(status.nextAction.command).toBe("runstead startup gate check --stage mvp");
      expect(formatStartupStatus(status)).toContain("Startup status");
      expect(formatStartupStatus(status)).toContain("Top blockers:");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
